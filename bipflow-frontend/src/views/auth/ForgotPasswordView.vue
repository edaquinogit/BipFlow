<script setup lang="ts">
import { reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'
import { AuthRouteNames } from '@/router/auth.routes'
import { authService } from '@/services/auth.service'
import { isAxiosError } from '@/types/errors'

const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const fieldErrors = reactive({ email: '' })
const form = reactive({ email: '' })

const validateEmail = (): boolean => {
  fieldErrors.email = ''
  const email = form.email.trim()

  if (!email) {
    fieldErrors.email = 'Informe o email cadastrado.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Informe um email válido.'
  }

  return !fieldErrors.email
}

const handlePasswordResetRequest = async () => {
  errorMessage.value = ''
  if (!validateEmail()) return

  isSubmitting.value = true
  successMessage.value = ''

  try {
    await authService.requestPasswordReset({
      email: form.email.trim().toLowerCase(),
    })
    successMessage.value = 'Se o email estiver cadastrado, você receberá um link seguro para redefinir a senha.'
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 429) {
      errorMessage.value = 'Muitas solicitações. Aguarde um momento antes de tentar novamente.'
    } else if (isAxiosError(error) && !error.response) {
      errorMessage.value = 'Falha de conexão. Verifique sua internet e tente novamente.'
    } else {
      errorMessage.value = 'Não foi possível enviar o link agora. Tente novamente mais tarde.'
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <AuthShell
    eyebrow="Recuperação segura"
    title="Vamos recuperar seu acesso."
    description="Enviaremos um link seguro e com expiração para o email administrativo cadastrado."
  >
    <header class="mb-7">
      <p class="mb-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#d60073]">Acesso administrativo</p>
      <h2 class="text-[2rem] font-extrabold tracking-[-0.045em] text-bip-black">Redefinir senha</h2>
      <p class="mt-2 text-sm leading-6 text-bip-muted">
        Informe seu email para receber as instruções de recuperação.
      </p>
    </header>

    <AuthAlert v-if="successMessage" class="mb-6" tone="success" title="Confira seu email">
      {{ successMessage }}
      <template #action>
        <RouterLink
          :to="{ name: AuthRouteNames.Login }"
          class="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#111827] px-4 font-semibold text-white transition-colors hover:bg-bip-black focus-visible:ring-2 focus-visible:ring-bip-black focus-visible:ring-offset-2"
        >
          Voltar ao login
        </RouterLink>
      </template>
    </AuthAlert>

    <AuthAlert v-if="errorMessage" class="mb-5" tone="error" data-cy="password-reset-error">
      {{ errorMessage }}
    </AuthAlert>

    <form v-if="!successMessage" class="space-y-2" novalidate @submit.prevent="handlePasswordResetRequest">
      <AuthField
        id="reset-request-email"
        v-model="form.email"
        name="email"
        label="Email cadastrado"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="admin@suaempresa.com"
        :error="fieldErrors.email"
        data-cy="password-reset-email"
        @input="fieldErrors.email = ''"
      />

      <AuthSubmitButton :loading="isSubmitting" loading-label="Enviando link...">
        Enviar link seguro
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
        O link é temporário e válido apenas para redefinir uma senha administrativa.
      </p>
    </template>
  </AuthShell>
</template>
