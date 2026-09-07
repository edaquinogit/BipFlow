<script setup lang="ts">
import { computed, ref } from 'vue'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline'

defineOptions({ inheritAttrs: false })

type InputMode = 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'

const props = withDefaults(defineProps<{
  id: string
  label: string
  modelValue: string
  type?: 'text' | 'email' | 'password'
  placeholder?: string
  autocomplete?: string
  inputmode?: InputMode
  maxlength?: number
  error?: string
  disabled?: boolean
  autofocus?: boolean
}>(), {
  type: 'text',
  placeholder: '',
  autocomplete: 'off',
  inputmode: 'text',
  error: '',
  disabled: false,
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const showPassword = ref(false)
const isPassword = computed(() => props.type === 'password')
const resolvedType = computed(() => isPassword.value && showPassword.value ? 'text' : props.type)
const errorId = computed(() => `${props.id}-error`)

const onInput = (event: Event) => {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="group space-y-1.5">
    <div class="flex min-h-5 items-center justify-between gap-3">
      <label
        :for="id"
        class="text-xs font-semibold uppercase tracking-[0.14em] text-bip-muted transition-colors group-focus-within:text-bip-black"
      >
        {{ label }}
      </label>
      <slot name="labelAction" />
    </div>

    <div class="relative">
      <input
        v-bind="$attrs"
        :id="id"
        :value="modelValue"
        :type="resolvedType"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :maxlength="maxlength"
        :disabled="disabled"
        :autofocus="autofocus"
        :aria-invalid="Boolean(error)"
        :aria-describedby="error ? errorId : undefined"
        class="min-h-12 w-full rounded-xl border bg-white px-4 text-base leading-6 text-bip-black shadow-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-zinc-400 focus:border-bip-black focus:ring-4 focus:ring-bip-blush disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
        :class="[
          error ? 'border-danger' : 'border-bip-line',
          isPassword ? 'pr-12' : '',
        ]"
        @input="onInput"
      />

      <button
        v-if="isPassword"
        type="button"
        class="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-bip-muted transition-colors hover:text-bip-black focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-inset"
        :aria-label="showPassword ? 'Ocultar senha' : 'Mostrar senha'"
        :aria-pressed="showPassword"
        @click="showPassword = !showPassword"
      >
        <EyeSlashIcon v-if="showPassword" class="h-5 w-5" aria-hidden="true" />
        <EyeIcon v-else class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>

    <p
      :id="errorId"
      class="min-h-5 text-xs leading-5 text-danger"
      :class="error ? 'visible' : 'invisible'"
      :role="error ? 'alert' : undefined"
      :aria-hidden="!error"
    >
      {{ error || '\u00a0' }}
    </p>
  </div>
</template>

<style scoped>
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus {
  -webkit-text-fill-color: #05050a;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset;
}
</style>
