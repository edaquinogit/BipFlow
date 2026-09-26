<script setup lang="ts">
import { nextTick, ref, toRef, watch } from 'vue';
import { ArrowPathIcon, BoltIcon, BoltSlashIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import { useDialogA11y } from '@/composables/useDialogA11y';
import { usePdvCameraScanner } from '@/composables/usePdvCameraScanner';

/**
 * Etapa C2 of the PDV camera-scanner evolution (see
 * docs/architecture/pdv-camera-scanner-refinement.md): lets the cashier
 * point a phone/tablet camera at a product's printed QR label instead of
 * typing/scanning the code with a USB HID reader. Purely a camera + decode
 * surface -- it has no idea what a decoded string means (a product code, an
 * unknown code, out of stock, ...): the parent (DashboardPdvView.vue) owns
 * that lookup and feeds the outcome back in via the `feedback` prop, the
 * same way it already drives the plain scan input's error message.
 */
export type PdvCameraFeedback = { type: 'success' | 'error'; message: string };

const props = defineProps<{
  show: boolean;
  feedback: PdvCameraFeedback | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'decode', rawText: string): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);

useDialogA11y(toRef(props, 'show'), () => emit('close'), containerRef, closeButtonRef);

const handleDecode = (rawText: string): void => {
  // Confirms a code was read at all, independent of whether the lookup that
  // follows succeeds -- the same instant feedback a real barcode gun gives.
  navigator.vibrate?.(80);
  emit('decode', rawText);
};

const {
  error,
  cameras,
  activeCameraId,
  hasMultipleCameras,
  hasTorch,
  isTorchOn,
  slowHint,
  start,
  stop,
  switchCamera,
  toggleTorch,
} = usePdvCameraScanner(videoRef, handleDecode);

const handleSwitchCamera = async (): Promise<void> => {
  const ids = cameras.value.map((camera) => camera.id);
  if (ids.length < 2) {
    return;
  }
  const currentIndex = activeCameraId.value ? ids.indexOf(activeCameraId.value) : -1;
  const nextId = ids[(currentIndex + 1) % ids.length];
  if (nextId) {
    await switchCamera(nextId);
  }
};

const handleClose = (): void => {
  stop();
  emit('close');
};

watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      await nextTick();
      await start();
    } else {
      stop();
    }
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="camera-overlay no-print" data-cy="pdv-camera-scanner">
        <div ref="containerRef" class="camera-container" role="dialog" aria-modal="true" aria-label="Escanear QR Code do produto">
          <div class="camera-header">
            <p class="text-[10px] font-black uppercase tracking-[0.3em] text-white/70">
              Aponte para o QR do produto
            </p>
            <button
              ref="closeButtonRef"
              type="button"
              data-cy="pdv-camera-close"
              aria-label="Fechar câmera"
              class="close-button"
              @click="handleClose"
            >
              <XMarkIcon class="h-5 w-5" />
            </button>
          </div>

          <div class="camera-viewport">
            <video ref="videoRef" class="camera-video" muted playsinline autoplay></video>
            <div v-if="!error" class="camera-reticle" aria-hidden="true"></div>
          </div>

          <p v-if="error" data-cy="pdv-camera-error" class="camera-message camera-message--error">
            {{ error.message }}
          </p>
          <p
            v-else-if="feedback"
            data-cy="pdv-camera-feedback"
            class="camera-message"
            :class="feedback.type === 'success' ? 'camera-message--success' : 'camera-message--error'"
          >
            {{ feedback.message }}
          </p>
          <p
            v-else-if="slowHint"
            data-cy="pdv-camera-slow-hint"
            role="status"
            aria-live="polite"
            class="camera-message camera-message--hint"
          >
            Aproxime o código, aumente o brilho da tela ou use a busca por nome.
          </p>

          <div class="camera-actions">
            <button
              v-if="hasTorch"
              type="button"
              data-cy="pdv-camera-torch"
              :aria-pressed="isTorchOn"
              :aria-label="isTorchOn ? 'Desligar lanterna' : 'Ligar lanterna'"
              class="switch-button"
              @click="toggleTorch"
            >
              <component :is="isTorchOn ? BoltSlashIcon : BoltIcon" class="mr-1.5 inline h-4 w-4" />
              {{ isTorchOn ? 'Lanterna ligada' : 'Lanterna' }}
            </button>

            <button
              v-if="hasMultipleCameras"
              type="button"
              data-cy="pdv-camera-switch"
              class="switch-button"
              @click="handleSwitchCamera"
            >
              <ArrowPathIcon class="mr-1.5 inline h-4 w-4" />
              Trocar câmera
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.camera-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(5, 5, 10, 0.95);
}

.camera-container {
  display: flex;
  width: 100%;
  max-width: 28rem;
  height: 100%;
  max-height: 42rem;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
}

.camera-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.close-button {
  display: flex;
  height: 2.75rem;
  width: 2.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  transition: all 0.2s ease;
}

.close-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.camera-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  border-radius: 1.5rem;
  background-color: #000000;
}

.camera-video {
  height: 100%;
  width: 100%;
  object-fit: cover;
}

.camera-reticle {
  position: absolute;
  inset: 15%;
  border: 3px solid rgba(17, 24, 39, 0.85);
  border-radius: 1.25rem;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.25);
}

.camera-message {
  border-radius: 0.75rem;
  padding: 0.75rem 1rem;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 700;
}

.camera-message--success {
  background-color: rgba(16, 185, 129, 0.15);
  color: #34d399;
}

.camera-message--error {
  background-color: rgba(17, 24, 39, 0.15);
  color: #f472b6;
}

.camera-message--hint {
  background-color: rgba(250, 204, 21, 0.15);
  color: #fde047;
}

.camera-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

.switch-button {
  align-self: center;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 0.6rem 1.25rem;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #ffffff;
  transition: all 0.2s ease;
}

.switch-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
