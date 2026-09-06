/**
 * BipFlow Toast Notification System
 *
 * Provides user feedback for async operations, errors, and confirmations.
 * Integrates with Vue's reactive system.
 *
 * Usage:
 *   const { notify } = useToast()
 *   notify('success', 'Product saved successfully')
 *   notify('error', 'Failed to load categories')
 */

import { ref, computed } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  autoClose?: boolean;
  action?: ToastAction;
  /** Ciclo 8: optional dedup key -- see `notify()`. */
  key?: string;
}

const toasts = ref<Toast[]>([]);
const MAX_VISIBLE_TOASTS = 3;

let toastCounter = 0;

/** Pending auto-close timers, keyed by toast id (Ciclo 8: needed so an
 * in-place update can cancel and restart the countdown instead of leaving
 * the old timer to remove the toast early/late). */
const autoCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Generate unique toast ID
 */
function generateId(): string {
  return `toast-${++toastCounter}-${Date.now()}`;
}

function clearAutoCloseTimer(id: string): void {
  const handle = autoCloseTimers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    autoCloseTimers.delete(id);
  }
}

function scheduleAutoClose(toast: Toast): void {
  if (toast.autoClose && toast.duration) {
    autoCloseTimers.set(
      toast.id,
      setTimeout(() => {
        removeToast(toast.id);
      }, toast.duration)
    );
  }
}

/**
 * Add a toast notification
 * @param type - Type of notification (success, error, warning, info)
 * @param message - Message to display
 * @param duration - Auto-close duration in milliseconds. Use 0 to keep it visible.
 * @param action - Optional secondary action (e.g. "Relatar problema"). A
 *   toast carrying one never auto-closes, regardless of `duration` -- it
 *   would be unfair to race the customer against a countdown to click it.
 * @param key - Ciclo 8: optional dedup key for a class of toasts that
 *   shouldn't stack (e.g. repeated "added to cart" confirmations). When a
 *   toast with the same `key` is already visible, this call replaces its
 *   message/type and restarts its auto-close timer *in place* (same id, same
 *   DOM node) instead of pushing a second toast -- so screen readers still
 *   see the live region's content change and announce it, but the list never
 *   grows for that key. Toasts without a `key` keep the original exact
 *   type+message dedup behavior and are otherwise independent (an error is
 *   never matched/removed by a keyed success, or vice versa).
 */
function notify(
  type: ToastType,
  message: string,
  duration?: number,
  action?: ToastAction,
  key?: string
): void {
  const defaultDurations: Record<ToastType, number> = {
    success: 2000,
    info: 3000,
    warning: 3800,
    error: 4800,
  };
  const resolvedDuration = duration ?? defaultDurations[type];
  const autoClose = resolvedDuration > 0 && !action;

  if (key) {
    const existingIndex = toasts.value.findIndex((toast) => toast.key === key);
    const existing = existingIndex !== -1 ? toasts.value[existingIndex] : undefined;
    if (existing) {
      clearAutoCloseTimer(existing.id);
      const updated: Toast = { ...existing, type, message, duration: resolvedDuration, autoClose, action };
      const next = toasts.value.slice();
      next[existingIndex] = updated;
      toasts.value = next;
      scheduleAutoClose(updated);
      return;
    }
  } else {
    toasts.value = toasts.value.filter(
      (toast) => toast.type !== type || toast.message !== message
    );
  }

  const toast: Toast = {
    id: generateId(),
    type,
    message,
    duration: resolvedDuration,
    autoClose,
    action,
    key,
  };

  const withNewToast = [...toasts.value, toast];
  const kept = withNewToast.slice(-MAX_VISIBLE_TOASTS);
  const dropped = withNewToast.slice(0, withNewToast.length - kept.length);
  for (const droppedToast of dropped) {
    clearAutoCloseTimer(droppedToast.id);
  }
  toasts.value = kept;

  scheduleAutoClose(toast);
}

/**
 * Notify success
 * @param key - Ciclo 8: optional dedup key, see `notify()`.
 */
function success(message: string, duration?: number, key?: string): void {
  notify('success', message, duration, undefined, key);
}

/**
 * Notify error
 */
function error(message: string, duration?: number, action?: ToastAction): void {
  notify('error', message, duration, action);
}

/**
 * Notify warning
 */
function warning(message: string, duration?: number): void {
  notify('warning', message, duration);
}

/**
 * Notify info
 */
function info(message: string, duration?: number): void {
  notify('info', message, duration);
}

/**
 * Remove a toast by ID
 */
function removeToast(id: string): void {
  clearAutoCloseTimer(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/**
 * Clear all toasts
 */
function clearAll(): void {
  for (const toast of toasts.value) {
    clearAutoCloseTimer(toast.id);
  }
  toasts.value = [];
}

/**
 * Vue composable for using toast notifications
 */
export function useToast() {
  return {
    toasts: computed(() => toasts.value),
    notify,
    success,
    error,
    warning,
    info,
    removeToast,
    clearAll,
  };
}
