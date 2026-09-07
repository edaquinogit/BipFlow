<script setup lang="ts">
withDefaults(defineProps<{
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
  loadingLabel?: string
}>(), {
  type: 'submit',
  disabled: false,
  loading: false,
  loadingLabel: 'Aguarde...',
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading"
    class="auth-submit-button relative inline-flex min-h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#111827] px-5 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow,transform] hover:bg-bip-black hover:shadow-md focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none disabled:transform-none"
  >
    <span class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#FF789F] to-[#FF008C]" aria-hidden="true" />
    <span
      v-if="loading"
      class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/35 border-t-white"
      aria-hidden="true"
    />
    <span>{{ loading ? loadingLabel : '' }}</span>
    <span v-if="!loading"><slot /></span>
  </button>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .auth-submit-button,
  .auth-submit-button span {
    animation: none;
    transition: none;
  }
}
</style>
