<script setup lang="ts">
import { CheckCircleIcon } from '@heroicons/vue/24/solid'
import type { PasswordRule } from '@/composables/usePasswordStrength'

withDefaults(defineProps<{
  rules: PasswordRule[]
  label: string
  filledBars: number
  totalBars: number
  barClass: string
  show?: boolean
}>(), {
  show: false,
})
</script>

<template>
  <div v-if="show" class="space-y-3" aria-live="polite">
    <div>
      <div
        class="grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${totalBars}, minmax(0, 1fr))` }"
        role="progressbar"
        aria-label="Força da senha"
        :aria-valuenow="filledBars"
        aria-valuemin="0"
        :aria-valuemax="totalBars"
        :aria-valuetext="label"
      >
        <span
          v-for="index in totalBars"
          :key="index"
          class="h-1.5 rounded-full transition-colors"
          :class="index <= filledBars ? barClass : 'bg-zinc-200'"
          aria-hidden="true"
        />
      </div>
      <p class="mt-1.5 text-xs font-semibold text-bip-muted">Força: {{ label }}</p>
    </div>

    <ul class="grid gap-2 border-t border-bip-line pt-3">
      <li
        v-for="rule in rules"
        :key="rule.label"
        class="flex items-center gap-2 text-xs"
        :class="rule.passed ? 'text-success' : 'text-bip-muted'"
      >
        <CheckCircleIcon v-if="rule.passed" class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span v-else class="h-2 w-2 shrink-0 rounded-full bg-zinc-300" aria-hidden="true" />
        {{ rule.label }}
      </li>
    </ul>
  </div>
</template>
