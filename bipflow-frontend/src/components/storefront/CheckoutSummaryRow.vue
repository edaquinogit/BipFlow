<script setup lang="ts">
/**
 * Ciclo 8 -- one row of the checkout financial summary (label + value).
 * Purely presentational: the caller passes already-formatted, already
 * reactive values (formatBRL(...)) -- this component never computes or
 * caches a money amount itself.
 */
withDefaults(
  defineProps<{
    label: string
    value: string
    /** The "Total" row: bigger, high-contrast text. */
    emphasis?: boolean
  }>(),
  { emphasis: false },
)
</script>

<template>
  <div
    class="flex items-baseline justify-between gap-3"
    :class="emphasis ? 'text-[var(--store-text)]' : 'text-[var(--store-text-muted)]'"
  >
    <span :class="emphasis ? 'text-sm font-semibold' : 'text-[0.8125rem]'">{{ label }}</span>
    <span :class="emphasis ? 'text-lg font-semibold' : 'text-[0.8125rem]'">{{ value }}</span>
  </div>
</template>
