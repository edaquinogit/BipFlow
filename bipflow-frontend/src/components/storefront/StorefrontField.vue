<script setup lang="ts">
/**
 * Shared storefront text field (Ciclo 1).
 *
 * - one construction for every storefront input (search, checkout, profile)
 * - 16px input text so mobile Safari never auto-zooms on focus
 * - label is always associated; optional leading icon slot
 * - error is announced via aria-invalid + aria-describedby
 * - focus-visible ring uses the store's contrast-checked --store-focus
 */
import { computed, ref, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string | number | null | undefined
    type?: string
    placeholder?: string
    error?: string | null
    hint?: string | null
    hideLabel?: boolean
    required?: boolean
    autocomplete?: string
    inputmode?: 'search' | 'text' | 'url' | 'email' | 'tel' | 'none' | 'numeric' | 'decimal'
    name?: string
    /** Overrides the accessible name on the input itself (kept for parity with
     *  existing markup that other code/tests target by aria-label). */
    ariaLabel?: string
  }>(),
  {
    type: 'text',
    hideLabel: false,
    required: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: [event: FocusEvent]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
defineExpose({ focus: () => inputRef.value?.focus() })

const uid = useId()
const inputId = `sf-field-${uid}`
const errorId = `sf-field-error-${uid}`
const hintId = `sf-field-hint-${uid}`

const describedBy = computed(() => {
  const ids: string[] = []
  if (props.hint) ids.push(hintId)
  if (props.error) ids.push(errorId)
  return ids.length ? ids.join(' ') : undefined
})

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="storefront-field">
    <label
      :for="inputId"
      class="mb-1.5 block text-xs font-semibold text-[var(--store-text-muted)]"
      :class="{ 'sr-only': hideLabel }"
    >
      {{ label }}<span v-if="required" aria-hidden="true"> *</span>
    </label>

    <div class="relative">
      <span
        v-if="$slots.icon"
        class="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-[var(--store-text-muted)]"
        aria-hidden="true"
      >
        <slot name="icon" />
      </span>

      <input
        :id="inputId"
        ref="inputRef"
        :name="name"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :required="required"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :aria-label="ariaLabel"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        class="storefront-field__input h-11 w-full rounded-[var(--store-radius-sm,0.5rem)] border bg-[var(--store-surface)] px-3.5 text-[16px] leading-6 text-[var(--store-text)] transition placeholder:text-[var(--store-text-muted)]"
        :class="[$slots.icon ? 'pl-10' : '', error ? 'storefront-field__input--error' : '']"
        @input="onInput"
        @blur="emit('blur', $event)"
      />
    </div>

    <p v-if="hint && !error" :id="hintId" class="mt-1.5 text-xs text-[var(--store-text-muted)]">
      {{ hint }}
    </p>
    <p v-if="error" :id="errorId" class="mt-1.5 text-xs font-medium text-[#B42318]">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.storefront-field__input {
  border-color: var(--store-border, #d1d5db);
  transition-duration: var(--motion-fast, 120ms);
}

.storefront-field__input:hover:not(:disabled) {
  border-color: var(--store-brand-on-light, #9ca3af);
}

.storefront-field__input:focus {
  outline: none;
  border-color: var(--store-focus, #05050a);
  box-shadow: 0 0 0 3px var(--store-brand-soft, rgba(5, 5, 10, 0.12));
}

.storefront-field__input:focus-visible {
  outline: 2px solid var(--store-focus, #05050a);
  outline-offset: 2px;
}

.storefront-field__input--error {
  border-color: #b42318;
}

.storefront-field__input:disabled {
  background: #f3f4f6;
  color: #9ca3af;
}
</style>
