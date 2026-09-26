import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';
import QrScanner from 'qr-scanner';
import { Logger } from '@/services/logger';

/**
 * Etapa C2 of the PDV camera-scanner evolution (see
 * docs/architecture/pdv-camera-scanner-refinement.md), reworked by the
 * PDV/QR/payment evolution (see docs/architecture/pdv-qr-payment-evolution.md)
 * for capture quality and observability: wraps `qr-scanner`'s camera
 * lifecycle (permissions, camera selection, decode loop) behind a small
 * typed surface. Deliberately knows nothing about products/cart -- the
 * caller decides what a decoded string means (see `parseScanPayload()` in
 * `utils/pdvScan.ts`), this composable only owns "is the camera open, is it
 * fighting to read, and did it just read something".
 *
 * Root-cause fixes for the "20s to read / never reads" report:
 *  - after start(), ask the live track for a higher capture resolution and
 *    continuous autofocus -- the default ~640x480 has too few pixels per
 *    module for a small printed QR that encodes a full URL;
 *  - a wider, higher-resolution scan region;
 *  - a torch toggle when the device exposes one (low light);
 *  - `performance.now()` marks so a slow read is visible in the logs
 *    instead of being a silent wait, and a `slowHint` flag the UI can act on.
 *
 * Privacy: no camera frame is ever captured, stored or sent anywhere. The
 * only telemetry is timing + a result code through the app logger; never a
 * decoded payload, an image, or anything identifying.
 */
export type PdvCameraScannerErrorReason =
  | 'insecure-context'
  | 'not-supported'
  | 'permission-denied'
  | 'no-camera'
  | 'unknown';

export interface PdvCameraScannerError {
  reason: PdvCameraScannerErrorReason;
  message: string;
}

const ERROR_MESSAGES: Record<PdvCameraScannerErrorReason, string> = {
  'insecure-context':
    'Este recurso exige uma conexão segura (HTTPS). Abra o painel por um endereço https:// para usar a câmera.',
  'not-supported': 'Este navegador não tem suporte à leitura de QR Code pela câmera.',
  'permission-denied':
    'Permissão de câmera negada. Autorize o acesso à câmera nas configurações do navegador e tente novamente.',
  'no-camera': 'Nenhuma câmera foi encontrada neste dispositivo.',
  unknown: 'Não foi possível acessar a câmera. Tente novamente.',
};

/**
 * Minimum time between two decode callbacks reaching the caller. Without
 * this, holding the camera steady over one label re-fires the same decode
 * many times per second.
 */
const DECODE_COOLDOWN_MS = 1200;

/** How long after the camera is ready without a valid decode before the UI
 * should nudge the operator (move closer, raise screen brightness, use the
 * product search). A silent wait past this point is the "20 second" bug. */
const SLOW_HINT_MS = 6000;

function mark(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function mapStartError(raw: unknown): PdvCameraScannerErrorReason {
  const name = raw instanceof DOMException ? raw.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'permission-denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'no-camera';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'unknown';
  }
  return 'unknown';
}

/** A centred square region, downscaled to a larger canvas than qr-scanner's
 * 400px default so a small/distant code keeps enough detail to decode. */
function calculateScanRegion(video: HTMLVideoElement): QrScanner.ScanRegion {
  // qr-scanner re-invokes this every frame, so a first call before metadata
  // has loaded (videoWidth/Height === 0) must still return a sane region.
  const width = video.videoWidth || 720;
  const height = video.videoHeight || 720;
  const size = Math.round(Math.min(width, height) * 0.7);
  const downScaled = Math.min(640, size);
  return {
    x: Math.max(0, Math.round((width - size) / 2)),
    y: Math.max(0, Math.round((height - size) / 2)),
    width: size,
    height: size,
    downScaledWidth: downScaled,
    downScaledHeight: downScaled,
  };
}

async function requestBetterCapture(video: HTMLVideoElement | undefined): Promise<void> {
  const stream = video?.srcObject as MediaStream | null | undefined;
  if (!stream || typeof stream.getVideoTracks !== 'function') {
    return;
  }
  const [track] = stream.getVideoTracks();
  if (!track || typeof track.applyConstraints !== 'function') {
    return;
  }
  try {
    await track.applyConstraints({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // `focusMode` isn't in the standard MediaTrackConstraints type yet but
      // is widely supported on mobile; a device that doesn't know it ignores it.
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
  } catch {
    // A device that can't honour the hint just keeps its current settings.
  }
}

export function usePdvCameraScanner(
  videoRef: Ref<HTMLVideoElement | null>,
  onDecode: (rawText: string) => void
) {
  const scanner = shallowRef<QrScanner | null>(null);
  const isActive = ref(false);
  const error = ref<PdvCameraScannerError | null>(null);
  const cameras = ref<QrScanner.Camera[]>([]);
  const activeCameraId = ref<string | null>(null);
  const hasTorch = ref(false);
  const isTorchOn = ref(false);
  const slowHint = ref(false);

  let lastAcceptedAt = 0;
  let scanStartedAt = 0;
  let cameraReadyAt = 0;
  let gotFirstDecode = false;
  let slowHintTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by every start() and every stop(). An in-flight start() whose
  // token no longer matches has been superseded (rapid close/reopen, or a
  // second start()) and must throw away the instance it just built --
  // otherwise a camera stream + decode loop leaks with nothing tracking it.
  let generation = 0;

  const setError = (reason: PdvCameraScannerErrorReason): void => {
    error.value = { reason, message: ERROR_MESSAGES[reason] };
  };

  const clearSlowHintTimer = (): void => {
    if (slowHintTimer !== null) {
      clearTimeout(slowHintTimer);
      slowHintTimer = null;
    }
  };

  const handleDecode = (result: QrScanner.ScanResult): void => {
    const now = Date.now();
    if (now - lastAcceptedAt < DECODE_COOLDOWN_MS) {
      return;
    }
    lastAcceptedAt = now;

    if (!gotFirstDecode) {
      gotFirstDecode = true;
      slowHint.value = false;
      clearSlowHintTimer();
      Logger.info('pdv.qr.decode_succeeded', {
        sinceReadyMs: Math.round(mark() - cameraReadyAt),
        sinceStartMs: Math.round(mark() - scanStartedAt),
      });
    }

    onDecode(result.data);
  };

  const loadCameras = async (): Promise<void> => {
    try {
      cameras.value = await QrScanner.listCameras(true);
    } catch {
      cameras.value = [];
    }
  };

  const refreshTorchCapability = async (): Promise<void> => {
    try {
      hasTorch.value = (await scanner.value?.hasFlash()) ?? false;
      isTorchOn.value = scanner.value?.isFlashOn() ?? false;
    } catch {
      hasTorch.value = false;
      isTorchOn.value = false;
    }
  };

  const start = async (): Promise<void> => {
    // Tear down anything still live (rapid reopen, or a prior start() still
    // awaiting) so there is only ever one stream and one decode loop.
    stop();
    const startToken = ++generation;

    error.value = null;
    slowHint.value = false;
    gotFirstDecode = false;
    scanStartedAt = mark();
    Logger.info('pdv.qr.scan_started', {});

    if (!window.isSecureContext) {
      setError('insecure-context');
      Logger.warn('pdv.qr.blocked', { reason: 'insecure-context' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('not-supported');
      Logger.warn('pdv.qr.blocked', { reason: 'not-supported' });
      return;
    }
    if (!(await QrScanner.hasCamera())) {
      if (startToken !== generation) {
        return;
      }
      setError('no-camera');
      Logger.warn('pdv.qr.blocked', { reason: 'no-camera' });
      return;
    }
    if (startToken !== generation || !videoRef.value) {
      return;
    }

    const instance = new QrScanner(videoRef.value, handleDecode, {
      preferredCamera: 'environment',
      maxScansPerSecond: 8,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      calculateScanRegion,
      returnDetailedScanResult: true,
    });

    try {
      await instance.start();
      if (startToken !== generation) {
        // Superseded while getUserMedia was resolving -- discard this stream.
        instance.stop();
        instance.destroy();
        return;
      }
      scanner.value = instance;
      isActive.value = true;
      cameraReadyAt = mark();
      Logger.info('pdv.qr.camera_ready', {
        sinceStartMs: Math.round(cameraReadyAt - scanStartedAt),
      });

      void requestBetterCapture(instance.$video);
      void loadCameras();
      void refreshTorchCapability();

      clearSlowHintTimer();
      slowHintTimer = setTimeout(() => {
        if (!gotFirstDecode) {
          slowHint.value = true;
          Logger.warn('pdv.qr.slow', { sinceReadyMs: SLOW_HINT_MS });
        }
      }, SLOW_HINT_MS);
    } catch (raw: unknown) {
      try {
        instance.destroy();
      } catch {
        // already torn down
      }
      if (startToken !== generation) {
        return;
      }
      const reason = mapStartError(raw);
      setError(reason);
      Logger.warn('pdv.qr.permission_or_start_failed', { reason });
    }
  };

  const stop = (): void => {
    // Supersede any in-flight start() so it discards the instance it builds.
    generation += 1;
    clearSlowHintTimer();
    slowHint.value = false;
    isTorchOn.value = false;
    hasTorch.value = false;
    scanner.value?.stop();
    scanner.value?.destroy();
    scanner.value = null;
    isActive.value = false;
  };

  const switchCamera = async (cameraId: string): Promise<void> => {
    if (!scanner.value) {
      return;
    }
    await scanner.value.setCamera(cameraId);
    activeCameraId.value = cameraId;
    void requestBetterCapture(scanner.value.$video);
    void refreshTorchCapability();
  };

  const toggleTorch = async (): Promise<void> => {
    if (!scanner.value || !hasTorch.value) {
      return;
    }
    try {
      await scanner.value.toggleFlash();
      isTorchOn.value = scanner.value.isFlashOn();
      Logger.info('pdv.qr.torch_toggled', { on: isTorchOn.value });
    } catch {
      // Some devices report a torch and then refuse to switch it -- leave
      // the last known state and don't surface a scary error for a light.
    }
  };

  onBeforeUnmount(stop);

  return {
    isActive,
    error,
    cameras,
    activeCameraId,
    hasMultipleCameras: computed(() => cameras.value.length > 1),
    hasTorch,
    isTorchOn,
    slowHint,
    start,
    stop,
    switchCamera,
    toggleTorch,
  };
}
