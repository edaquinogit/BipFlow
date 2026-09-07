<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{
  verified: [token: string]
  expired: []
  error: []
}>()

const container = ref<HTMLElement | null>(null)
let widgetId: string | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()

  const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
  if (existing?.dataset.turnstileState === 'error') {
    existing.remove()
  } else if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile-load-failed')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstile = 'true'
    script.dataset.turnstileState = 'loading'
    script.onload = () => {
      script.dataset.turnstileState = 'loaded'
      resolve()
    }
    script.onerror = () => {
      script.dataset.turnstileState = 'error'
      reject(new Error('turnstile-load-failed'))
    }
    document.head.appendChild(script)
  })
}

async function renderWidget(): Promise<void> {
  try {
    await loadScript()

    if (!window.turnstile || !container.value) {
      emit('error')
      return
    }

    widgetId = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      theme: 'light',
      size: 'flexible',
      callback: (token: string) => emit('verified', token),
      'expired-callback': () => emit('expired'),
      'error-callback': () => {
        emit('error')
        return true
      },
    })
  } catch {
    emit('error')
  }
}

onMounted(() => {
  void renderWidget()
})

onBeforeUnmount(() => {
  if (widgetId && window.turnstile) {
    window.turnstile.remove(widgetId)
  }
})
</script>

<template>
  <div
    ref="container"
    class="min-h-[65px] w-full overflow-hidden rounded-xl"
    data-cy="turnstile-widget"
    aria-label="Verificação de segurança"
  />
</template>
