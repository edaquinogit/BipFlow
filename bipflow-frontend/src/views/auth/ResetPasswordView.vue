<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthPasswordStrength from '@/components/auth/AuthPasswordStrength.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'
import { usePasswordStrength } from '@/composables/usePasswordStrength'
import { AuthRouteNames } from '@/router/auth.routes'
import { authService } from '@/services/auth.service'
import type { ApiError } from '@/types/auth'

const route = useRoute()
const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const form = reactive({
  password: '',
  confirm_password: '',
})

const fieldErrors = reactive({
  password: '',
  confirm_password: '',
})

const uid = computed(() => String(route.query.uid || route.params.token || ''))
const token = computed(() => String(route.query.token || ''))
const hasValidLink = computed(() => Boolean(uid.value && token.value))

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

const validateForm = (): boolean => {
  fieldErrors.password = ''
  fieldErrors.confirm_password = ''

  if (!form.password) {
    fieldErrors.password = 'Crie uma nova senha.'
  } else if (!isPasswordValid.value) {
    fieldErrors.password = 'A senha ainda não atende a todos os critérios.'
  }

  if (!form.confirm_password) {
    fieldErrors.confirm_password = 'Confirme a nova senha.'
  } else if (!confirmRule.value.passed) {
    fieldErrors.confirm_password = 'As senhas não coincidem.'
  }

  return hasValidLink.value && !fieldErrors.password && !fieldErrors.confirm_password
}

const extractErrorMessage = (error: unknown) => {
  const data = (error as ApiError).response?.data
  if (!data) return 'Não foi possível redefinir a senha agora. Verifique sua conexão e tente novamente.'
  if (typeof data.detail === 'string') return data.detail
  if (typeof data.message === 'string') return data.message

  const firstFieldError = Object.values(data).find((value) => Array.isArray(value) || typeof value === 'string')
  if (Array.isArray(firstFieldError)) {
    return String(firstFieldError[0] || 'Confira os dados informados.')
  }

  return typeof firstFieldError === 'string'
    ? firstFieldError
    : 'O link pode ter expirado ou já ter sido utilizado. Solicite uma nova recuperação.'
}

const handlePasswordResetConfirm = async () => {
  errorMessage.value = ''

  if (!hasValidLink.value) {
    errorMessage.value = 'Este link está incompleto ou inválido. Solicite um novo email de recuperação.'
    return
  }

  if (!validateForm()) return

  isSubmitting.value = true
  successMessage.value = ''

  try {
    const response = await authService.confirmPasswordReset({
      uid: uid.value,
      token: token.value,
      password: form.password,
      confirm_password: form.confirm_password,
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
    eyebrow="Nova senha"
    title="Defina uma senha forte e exclusiva."
    description="Uma senha exclusiva para o BipFlow Manage protege o acesso administrativo da sua loja."
  >
    <header class="mb-7">
      <p class="mb-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#d60073]">Proteção da conta</p>
      <h2 class="text-[2rem] font-extrabold tracking-[-0.045em] text-bip-black">Criar nova senha</h2>
      <p class="mt-2 text-sm leading-6 text-bip-muted">
        Escolha uma senha forte, exclusiva e fácil de reconhecer apenas por você.
      </p>
    </header>

    <AuthAlert v-if="successMessage" class="mb-6" tone="success" title="Senha redefinida">
      {{ successMessage }}
      <template #action>
        <RouterLink
          :to="{ name: AuthRouteNames.Login }"
          class="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#111827] px-4 font-semibold text-white transition-colors hover:bg-bip-black focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-offset-2"
        >
          Entrar no BipFlow
        </RouterLink>
      </template>
    </AuthAlert>

    <AuthAlert v-else-if="!hasValidLink" class="mb-6" tone="warning" title="Link inválido ou incompleto">
      Este link não possui os parâmetros de segurança necessários ou já expirou.
      <template #action>
        <RouterLink
          :to="{ name: AuthRouteNames.ForgotPassword }"
          class="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#111827] px-4 font-semibold text-white transition-colors hover:bg-bip-black focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-offset-2"
        >
          Solicitar novo link
        </RouterLink>
      </template>
    </AuthAlert>

    <AuthAlert v-if="errorMessage && hasValidLink" class="mb-5" tone="error" data-cy="password-reset-confirm-error">
      {{ errorMessage }}
    </AuthAlert>

    <form
      v-if="!successMessage && hasValidLink"
      class="space-y-1"
      novalidate
      @submit.prevent="handlePasswordResetConfirm"
    >
      <AuthField
        id="new-password"
        v-model="form.password"
        name="password"
        label="Nova senha"
        type="password"
        autocomplete="new-password"
        placeholder="Digite a nova senha"
        :error="fieldErrors.password"
        data-cy="new-password"
        @input="fieldErrors.password = ''"
      />

      <AuthField
        id="new-password-confirmation"
        v-model="form.confirm_password"
        name="confirm_password"
        label="Confirmar nova senha"
        type="password"
        autocomplete="new-password"
        placeholder="Repita a nova senha"
        :error="fieldErrors.confirm_password"
        data-cy="new-password-confirmation"
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

      <AuthSubmitButton :loading="isSubmitting" loading-label="Redefinindo senha...">
        Redefinir senha
      </AuthSubmitButton>
    </form>

    <template #footer>
      <RouterLink
        :to="{ name: AuthRouteNames.Login }"
        class="text-sm font-bold text-bip-black underline-offset-4 hover:underline"
      >
        Voltar ao login
      </RouterLink>
      <p class="mt-4 text-xs leading-5 text-bip-muted">
        Use uma senha exclusiva para proteger o painel administrativo.
      </p>
    </template>
  </AuthShell>
</template>
