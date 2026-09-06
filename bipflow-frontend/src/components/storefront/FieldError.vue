<script setup lang="ts">
/**
 * Ciclo 8 -- one small presentational piece reused by every validated
 * checkout field: a short message, an icon (never color alone), and the
 * `id` the field's `aria-describedby` points at. No `role`/`aria-live` here
 * on purpose -- the field is already linked to it via `aria-describedby`,
 * and stacking `role="alert"` on every field would make several regions
 * compete for the screen reader's attention at once.
 */
import { ExclamationCircleIcon } from '@heroicons/vue/24/outline'

defineProps<{
  id: string
  message: string
}>()
</script>

<template>
  <p
    v-if="message"
    :id="id"
    class="mt-1 flex items-start gap-1 text-[0.75rem] font-medium text-[var(--color-danger)]"
  >
    <ExclamationCircleIcon class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{{ message }}</span>
  </p>
</template>
