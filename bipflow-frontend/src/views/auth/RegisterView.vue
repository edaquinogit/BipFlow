<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthPasswordStrength from '@/components/auth/AuthPasswordStrength.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'
import { usePasswordStrength } from '@/composables/usePasswordStrength'
import { AuthRouteNames } from '@/router/auth.routes'
import { authService } from '@/services/auth.service'
import type { ApiError } from '@/types/auth'

const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const form = reactive({
  email: '',
  password: '',
  confirm_password: '',
  store_name: '',
})

const fieldErrors = reactive({
  email: '',
  password: '',
  confirm_password: '',
  store_name: '',
})

const {
  rules: passwordRules,
  label: strengthLabel,
  barClass: strengthBarClass,
  filledBars: strengthFilledBars,
  totalBars: strengthTotalBars,
  isValid: isPasswordValid,
} = usePasswordStrength(computed(() => form.password))

const confirmRule = computed(() => ({
  label: 'Confirmação igual à senha',
  passed: Boolean(form.confirm_password) && form.password === form.confirm_password,
}))

const allPasswordRules = computed(() => [...passwordRules.value, confirmRule.value])

const clearFieldErrors = () => {
  fieldErrors.email = ''
  fieldErrors.password = ''
  fieldErrors.confirm_password = ''
  fieldErrors.store_name = ''
}

const validateForm = (): boolean => {
  clearFieldErrors()

  if (!form.store_name.trim()) {
    fieldErrors.store_name = 'Informe o nome da sua loja.'
  }

  const email = form.email.trim()
  if (!email) {
    fieldErrors.email = 'Informe seu email administrativo.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Informe um email válido.'
  }

  if (!form.password) {
    fieldErrors.password = 'Crie uma senha para proteger sua conta.'
  } else if (!isPasswordValid.value) {
    fieldErrors.password = 'A senha ainda não atende a todos os critérios.'
  }

  if (!form.confirm_password) {
    fieldErrors.confirm_password = 'Confirme a senha criada.'
  } else if (!confirmRule.value.passed) {
    fieldErrors.confirm_password = 'As senhas não coincidem.'
  }

  return Object.values(fieldErrors).every((message) => !message)
}

const extractErrorMessage = (error: unknown) => {
  const data = (error as ApiError).response?.data
  if (!data) return 'Não foi possível criar sua conta agora. Verifique sua conexão e tente novamente.'
  if (typeof data.detail === 'string') return data.detail
  if (typeof data.message === 'string') return data.message

  const firstFieldError = Object.values(data).find((value) => Array.isArray(value) || typeof value === 'string')
  if (Array.isArray(firstFieldError)) {
    return String(firstFieldError[0] || 'Confira os dados informados.')
  }

  return typeof firstFieldError === 'string'
    ? firstFieldError
    : 'Confira os dados informados e tente novamente.'
}

const handleRegister = async () => {
  errorMessage.value = ''
  if (!validateForm()) return

  isSubmitting.value = true
  successMessage.value = ''

  try {
    const response = await authService.register({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      confirm_password: form.confirm_password,
      store_name: form.store_name.trim(),
    })
    successMessage.value = response.message
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <AuthShell
    eyebrow="Novo acesso"
    title="Comece a vender em minutos."
    description="Crie sua loja e tenha controle sobre produtos, pedidos e atendimento desde o primeiro dia."
  >
    <header class="mb-7">
      <p class="mb-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#d60073]">Configuração inicial</p>
      <h2 class="text-[2rem] font-extrabold tracking-[-0.045em] text-bip-black">Criar sua loja</h2>
      <p class="mt-2 text-sm leading-6 text-bip-muted">
        Defina a identidade da loja e uma credencial administrativa segura.
      </p>
    </header>

    <AuthAlert v-if="successMessage" class="mb-6" tone="success" title="Conta criada">
      {{ successMessage }}
      <template #action>
        <RouterLink
          :to="{ name: AuthRouteNames.Login }"
          class="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#111827] px-4 font-semibold text-white transition-colors hover:bg-bip-black focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-offset-2"
        >
          Ir para o login
        </RouterLink>
      </template>
    </AuthAlert>

    <AuthAlert v-if="errorMessage" class="mb-5" tone="error" data-cy="register-error">
      {{ errorMessage }}
    </AuthAlert>

    <form v-if="!successMessage" class="space-y-1" novalidate @submit.prevent="handleRegister">
      <AuthField
        id="register-store-name"
        v-model="form.store_name"
        name="store_name"
        label="Nome da loja"
        autocomplete="organization"
        placeholder="Ex.: Pizzaria do João"
        :error="fieldErrors.store_name"
        data-cy="register-store-name"
        @input="fieldErrors.store_name = ''"
      />

      <AuthField
        id="register-email"
        v-model="form.email"
        name="email"
        label="Email administrativo"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="admin@suaempresa.com"
        :error="fieldErrors.email"
        data-cy="register-email"
        @input="fieldErrors.email = ''"
      />

      <AuthField
        id="register-password"
        v-model="form.password"
        name="password"
        label="Senha"
        type="password"
        autocomplete="new-password"
        placeholder="Crie uma senha segura"
        :error="fieldErrors.password"
        data-cy="register-password"
        @input="fieldErrors.password = ''"
      />

      <AuthField
        id="register-password-confirmation"
        v-model="form.confirm_password"
        name="confirm_password"
        label="Confirmar senha"
        type="password"
        autocomplete="new-password"
        placeholder="Repita a senha"
        :error="fieldErrors.confirm_password"
        data-cy="register-password-confirmation"
        @input="fieldErrors.confirm_password = ''"
      />

      <AuthPasswordStrength
        class="pb-3"
        :rules="allPasswordRules"
        :label="strengthLabel"
        :filled-bars="strengthFilledBars"
        :total-bars="strengthTotalBars"
        :bar-class="strengthBarClass"
        :show="Boolean(form.password || form.confirm_password)"
      />

      <AuthSubmitButton :loading="isSubmitting" loading-label="Criando conta...">
        Criar conta segura
      </AuthSubmitButton>
    </form>

    <template #footer>
      <RouterLink
        :to="{ name: AuthRouteNames.Login }"
        class="text-sm font-bold text-bip-black underline-offset-4 hover:underline"
      >
        Já tenho uma conta administrativa
      </RouterLink>
      <p class="mt-4 text-xs leading-5 text-bip-muted">
        Contas administrativas devem ser usadas apenas por pessoas autorizadas.
      </p>
    </template>
  </AuthShell>
</template>
