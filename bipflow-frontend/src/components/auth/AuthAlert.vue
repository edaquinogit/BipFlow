<script setup lang="ts">
import { computed } from 'vue'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/vue/24/outline'

type AuthAlertTone = 'info' | 'warning' | 'error' | 'success'

const props = withDefaults(defineProps<{
  tone?: AuthAlertTone
  title?: string
}>(), {
  tone: 'info',
  title: '',
})

const config = computed(() => ({
  info: {
    icon: InformationCircleIcon,
    classes: 'border-info-border bg-info-soft text-info',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    classes: 'border-warning-border bg-warning-soft text-warning',
  },
  error: {
    icon: XCircleIcon,
    classes: 'border-danger-border bg-danger-soft text-danger',
  },
  success: {
    icon: CheckCircleIcon,
    classes: 'border-success-border bg-success-soft text-success',
  },
}[props.tone]))

const role = computed(() => props.tone === 'error' ? 'alert' : 'status')
const ariaLive = computed(() => props.tone === 'error' ? 'assertive' : 'polite')
</script>

<template>
  <div
    :role="role"
    :aria-live="ariaLive"
    class="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-6"
    :class="config.classes"
  >
    <component :is="config.icon" class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div :class="title ? 'mt-0.5' : ''">
        <slot />
      </div>
      <div v-if="$slots.action" class="mt-3">
        <slot name="action" />
      </div>
    </div>
  </div>
</template>
