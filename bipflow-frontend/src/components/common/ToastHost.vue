<script setup lang="ts">
import { useToast } from '@/composables/useToast';
import { isStorefrontOverlayOpen } from '@/composables/useStorefrontOverlay';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';

const { toasts, removeToast } = useToast();

const toastConfig = {
  success: {
    label: 'Sucesso',
    icon: CheckCircleIcon,
    accent: 'bg-success',
    iconWrap: 'bg-success-soft text-success ring-success-border',
  },
  error: {
    label: 'Atencao',
    icon: XCircleIcon,
    accent: 'bg-danger',
    iconWrap: 'bg-danger-soft text-danger ring-danger-border',
  },
  warning: {
    label: 'Aviso',
    icon: ExclamationTriangleIcon,
    accent: 'bg-warning',
    iconWrap: 'bg-warning-soft text-warning ring-warning-border',
  },
  info: {
    label: 'Informacao',
    icon: InformationCircleIcon,
    accent: 'bg-info',
    iconWrap: 'bg-info-soft text-info ring-info-border',
  },
};
</script>

<template>
  <Teleport to="body">
    <TransitionGroup
      v-if="toasts.length"
      name="toast-list"
      tag="div"
      class="pointer-events-none fixed z-50 flex flex-col gap-3 sm:w-[min(26rem,calc(100vw-2rem))]"
      :class="isStorefrontOverlayOpen
        ? 'inset-x-3 top-[6rem] sm:inset-x-auto sm:left-4 sm:right-auto sm:top-4'
        : 'inset-x-3 top-3 sm:inset-x-auto sm:right-4 sm:top-4'"
      data-cy="toast-container"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border border-slate-200/90 bg-white/95 px-4 py-3 pl-5 text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,0.18)] ring-1 ring-black/5 backdrop-blur"
        :data-cy="`toast-${toast.type}`"
        :role="toast.type === 'error' ? 'alert' : 'status'"
        :aria-live="toast.type === 'error' ? 'assertive' : 'polite'"
      >
        <span
          class="absolute inset-y-0 left-0 w-1"
          :class="toastConfig[toast.type].accent"
          aria-hidden="true"
        />

        <span
          class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1"
          :class="toastConfig[toast.type].iconWrap"
          aria-hidden="true"
        >
          <component :is="toastConfig[toast.type].icon" class="h-5 w-5" />
        </span>

        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold leading-4 text-slate-900">
            {{ toastConfig[toast.type].label }}
          </p>
          <p class="mt-0.5 text-sm leading-5 text-slate-600">
            {{ toast.message }}
          </p>
          <button
            v-if="toast.action"
            type="button"
            class="mt-2 text-xs font-bold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-300"
            @click="toast.action.onClick(); removeToast(toast.id)"
          >
            {{ toast.action.label }}
          </button>
        </div>

        <button
          type="button"
          class="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          :aria-label="`Fechar notificacao: ${toastConfig[toast.type].label}`"
          @click="removeToast(toast.id)"
        >
          <XMarkIcon class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toast-list-enter-active,
.toast-list-leave-active {
  transition:
    opacity 240ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.toast-list-enter-from,
.toast-list-leave-to {
  opacity: 0;
  transform: translate3d(0, -10px, 0) scale(0.98);
}

.toast-list-move {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .toast-list-enter-active,
  .toast-list-leave-active,
  .toast-list-move {
    transition: none;
  }
}
</style>
