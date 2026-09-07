<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { BoltIcon, ChatBubbleLeftRightIcon, Square3Stack3DIcon } from '@heroicons/vue/24/outline'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthShell from '@/components/auth/AuthShell.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'
import TurnstileWidget from '@/components/auth/TurnstileWidget.vue'
import { AuthRouteNames } from '@/router/auth.routes'
import { DashboardRoutes } from '@/router/dashboard.routes'
import { authService } from '@/services/auth.service'
import { isAxiosError } from '@/types/errors'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

const router = useRouter()
const route = useRoute()
const isLoading = ref(false)
const errorMessage = ref('')
const validationHint = ref('')
const requiresCaptcha = ref(false)
const captchaToken = ref('')
const captchaError = ref('')
const captchaRenderKey = ref(0)
const rememberMe = ref(false)

const mfaToken = ref('')
const mfaCode = ref('')
const useBackupCode = ref(false)
const isVerifyingMfa = ref(false)

const form = reactive({
  email: '',
  password: '',
})

const fieldErrors = reactive({
  email: '',
  password: '',
  mfaCode: '',
})

const captchaAvailable = computed(() => Boolean(TURNSTILE_SITE_KEY))
const canSubmit = computed(() => (
  !isLoading.value
  && (!requiresCaptcha.value || (captchaAvailable.value && Boolean(captchaToken.value)))
))
const canSubmitMfa = computed(() => !isVerifyingMfa.value && Boolean(mfaCode.value.trim()))

const normalizedMfaCode = computed({
  get: () => mfaCode.value,
  set: (value: string) => {
    mfaCode.value = useBackupCode.value
      ? value.toUpperCase().slice(0, 32)
      : value.replace(/\D/g, '').slice(0, 6)
    fieldErrors.mfaCode = ''
  },
})

const sessionNotice = computed(() => {
  switch (route.query.reason) {
    case 'session_expired':
      return 'Sua sessão expirou. Entre novamente para continuar.'
    case 'auth_required':
      return 'Você precisa entrar para acessar essa página.'
    default:
      return ''
  }
})

const highlights = [
  { icon: BoltIcon, label: 'Pedidos em tempo real, sem recarregar a tela' },
  { icon: Square3Stack3DIcon, label: 'Catálogo e categorias sempre atualizados' },
  { icon: ChatBubbleLeftRightIcon, label: 'Atendimento centralizado em um só painel' },
]

const postLoginRedirectTarget = computed(() => {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect ? redirect : null
})

const clearLoginFieldErrors = () => {
  fieldErrors.email = ''
  fieldErrors.password = ''
}

const validateLogin = (): boolean => {
  clearLoginFieldErrors()

  const email = form.email.trim()
  if (!email) {
    fieldErrors.email = 'Informe seu email administrativo.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Informe um email válido.'
  }

  if (!form.password) {
    fieldErrors.password = 'Informe sua senha.'
  }

  return !fieldErrors.email && !fieldErrors.password
}

const handleCaptchaVerified = (token: string) => {
  captchaToken.value = token
  captchaError.value = ''
  validationHint.value = ''
}

const handleCaptchaExpired = () => {
  captchaToken.value = ''
  validationHint.value = 'A verificação expirou. Confirme novamente para continuar.'
}

const handleCaptchaError = () => {
  captchaToken.value = ''
  captchaError.value = 'Não foi possível carregar a verificação de segurança.'
}

const retryCaptcha = () => {
  captchaToken.value = ''
  captchaError.value = ''
  captchaRenderKey.value += 1
}

const formatWait = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  return `${Math.ceil(seconds / 60)} min`
}

const goToPostLoginDestination = () => {
  const redirect = postLoginRedirectTarget.value
  if (redirect) {
    void router.push(redirect)
    return
  }

  void router.push({ name: DashboardRoutes.Overview })
}

const handleLogin = async () => {
  validationHint.value = ''
  errorMessage.value = ''

  if (!validateLogin()) return

  if (requiresCaptcha.value && !captchaAvailable.value) {
    captchaError.value = 'A verificação de segurança está temporariamente indisponível. Recarregue a página ou tente novamente mais tarde.'
    return
  }

  if (requiresCaptcha.value && !captchaToken.value) {
    validationHint.value = 'Conclua a verificação de segurança para continuar.'
    return
  }

  isLoading.value = true

  try {
    const result = await authService.login({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      remember_me: rememberMe.value,
      captcha_token: captchaToken.value || undefined,
    })

    if ('mfa_required' in result) {
      mfaToken.value = result.mfa_token
      mfaCode.value = ''
      return
    }

    goToPostLoginDestination()
  } catch (error) {
    if (isAxiosError(error)) {
      const status = error.response?.status

      if (error.response?.data?.details?.requires_captcha) {
        requiresCaptcha.value = true
        captchaToken.value = ''
        validationHint.value = captchaAvailable.value
          ? 'Conclua a verificação de segurança para continuar.'
          : ''
        if (!captchaAvailable.value) {
          captchaError.value = 'A verificação de segurança está temporariamente indisponível. Recarregue a página ou tente novamente mais tarde.'
        }
      } else if (status === 429) {
        const waitSeconds = Number(error.response?.headers?.['retry-after'])
        errorMessage.value = Number.isFinite(waitSeconds) && waitSeconds > 0
          ? `Muitas tentativas. Tente novamente em ${formatWait(waitSeconds)}.`
          : 'Muitas tentativas. Aguarde um momento e tente novamente.'
      } else if (status === 401) {
        errorMessage.value = 'Email ou senha inválidos.'
        captchaToken.value = ''
      } else if (status) {
        errorMessage.value = 'Não foi possível entrar agora. Tente novamente.'
      } else {
        errorMessage.value = 'Falha de conexão. Verifique sua internet e tente novamente.'
      }
    } else {
      errorMessage.value = 'Não foi possível entrar agora. Tente novamente.'
    }
  } finally {
    isLoading.value = false
  }
}

const handleVerifyMfa = async () => {
  fieldErrors.mfaCode = ''
  errorMessage.value = ''
  validationHint.value = ''

  const code = mfaCode.value.trim()
  if (!code) {
    fieldErrors.mfaCode = useBackupCode.value
      ? 'Informe um código de backup.'
      : 'Informe o código de 6 dígitos.'
    return
  }

  if (!useBackupCode.value && code.length !== 6) {
    fieldErrors.mfaCode = 'O código deve ter 6 dígitos.'
    return
  }

  isVerifyingMfa.value = true

  try {
    await authService.verifyMfa({
      mfa_token: mfaToken.value,
      ...(useBackupCode.value ? { backup_code: code } : { code }),
    })
    goToPostLoginDestination()
  } catch (error) {
    errorMessage.value = isAxiosError(error) && error.response?.status === 429
      ? 'Muitas tentativas. Aguarde um momento e tente novamente.'
      : useBackupCode.value
        ? 'Código de backup inválido ou já utilizado.'
        : 'Código inválido. Confira o aplicativo autenticador e tente novamente.'
  } finally {
    isVerifyingMfa.value = false
  }
}

const toggleBackupCode = () => {
  useBackupCode.value = !useBackupCode.value
  mfaCode.value = ''
  fieldErrors.mfaCode = ''
  errorMessage.value = ''
}

const handleBackToLogin = () => {
  mfaToken.value = ''
  mfaCode.value = ''
  useBackupCode.value = false
  errorMessage.value = ''
  validationHint.value = ''
  fieldErrors.mfaCode = ''
}
</script>

<template>
  <AuthShell
    eyebrow="Painel administrativo"
    title="Sua operação, sob controle total."
    description="Gerencie produtos, pedidos e atendimento em um painel pensado para o dia a dia do seu delivery."
  >
    <template #highlights>
      <li
        v-for="item in highlights"
        :key="item.label"
        class="flex max-w-md items-center gap-3.5 text-sm text-zinc-300"
      >
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055]">
          <component :is="item.icon" class="h-[18px] w-[18px] text-[#ff4ca8]" aria-hidden="true" />
        </span>
        {{ item.label }}
      </li>
    </template>

    <header class="mb-7">
      <p class="mb-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#d60073]">
        {{ mfaToken ? 'Verificação adicional' : 'Acesso seguro' }}
      </p>
      <h2 class="text-[1.75rem] font-extrabold tracking-[-0.045em] text-bip-black sm:text-[2rem]">
        {{ mfaToken ? 'Verificação em duas etapas' : 'Entre na sua conta' }}
      </h2>
      <p class="mt-2 text-sm leading-6 text-bip-muted">
        {{ mfaToken
          ? (useBackupCode ? 'Digite um dos seus códigos de backup.' : 'Digite o código exibido no seu aplicativo autenticador.')
          : 'Use suas credenciais administrativas para continuar.' }}
      </p>
    </header>

    <div class="mb-5 grid gap-3" aria-live="polite">
      <AuthAlert v-if="sessionNotice && !mfaToken" data-cy="session-notice" tone="info">
        {{ sessionNotice }}
      </AuthAlert>
      <AuthAlert v-if="validationHint" data-cy="login-hint" tone="warning">
        {{ validationHint }}
      </AuthAlert>
      <AuthAlert v-if="errorMessage" data-cy="login-error" tone="error">
        {{ errorMessage }}
      </AuthAlert>
      <AuthAlert v-if="captchaError" data-cy="captcha-error" tone="error" title="Verificação indisponível">
        {{ captchaError }}
        <template #action>
          <button
            v-if="captchaAvailable"
            type="button"
            class="min-h-11 rounded-lg border border-danger-border bg-white px-4 font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-danger"
            @click="retryCaptcha"
          >
            Tentar novamente
          </button>
        </template>
      </AuthAlert>
    </div>

    <form v-if="!mfaToken" class="space-y-1" novalidate @submit.prevent="handleLogin">
      <AuthField
        id="admin-email"
        v-model="form.email"
        name="email"
        label="Email"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="admin@suaempresa.com"
        :error="fieldErrors.email"
        data-cy="login-email"
        @input="fieldErrors.email = ''"
      />

      <AuthField
        id="admin-password"
        v-model="form.password"
        name="password"
        label="Senha"
        type="password"
        autocomplete="current-password"
        placeholder="Digite sua senha"
        :error="fieldErrors.password"
        data-cy="login-password"
        @input="fieldErrors.password = ''"
      >
        <template #labelAction>
          <RouterLink
            :to="{ name: AuthRouteNames.ForgotPassword }"
            class="text-xs font-semibold text-bip-black underline-offset-4 hover:underline"
          >
            Esqueci minha senha
          </RouterLink>
        </template>
      </AuthField>

      <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg text-sm text-bip-muted">
        <input
          v-model="rememberMe"
          type="checkbox"
          class="h-5 w-5 rounded border-bip-line text-bip-black focus:ring-2 focus:ring-bip-black focus:ring-offset-2"
        />
        Lembrar de mim neste dispositivo
      </label>

      <div v-if="requiresCaptcha && captchaAvailable" class="py-3">
        <TurnstileWidget
          :key="captchaRenderKey"
          :site-key="TURNSTILE_SITE_KEY!"
          @verified="handleCaptchaVerified"
          @expired="handleCaptchaExpired"
          @error="handleCaptchaError"
        />
      </div>

      <div class="pt-3">
        <AuthSubmitButton :disabled="!canSubmit" :loading="isLoading" loading-label="Entrando...">
          Entrar no BipFlow
        </AuthSubmitButton>
      </div>
    </form>

    <form v-else class="space-y-2" data-cy="mfa-verify-form" novalidate @submit.prevent="handleVerifyMfa">
      <AuthField
        id="mfa-code"
        v-model="normalizedMfaCode"
        name="mfa_code"
        :label="useBackupCode ? 'Código de backup' : 'Código de 6 dígitos'"
        type="text"
        :inputmode="useBackupCode ? 'text' : 'numeric'"
        autocomplete="one-time-code"
        :maxlength="useBackupCode ? 32 : 6"
        :placeholder="useBackupCode ? 'AB3K-9XQ2' : '123456'"
        :error="fieldErrors.mfaCode"
        autofocus
        class="text-center tracking-[0.28em]"
        data-cy="mfa-code"
      />

      <AuthSubmitButton :disabled="!canSubmitMfa" :loading="isVerifyingMfa" loading-label="Verificando...">
        Verificar acesso
      </AuthSubmitButton>

      <div class="flex flex-col gap-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          class="min-h-11 text-left text-sm font-semibold text-bip-muted transition-colors hover:text-bip-black"
          @click="toggleBackupCode"
        >
          {{ useBackupCode ? 'Usar código do autenticador' : 'Usar código de backup' }}
        </button>
        <button
          type="button"
          class="min-h-11 text-left text-sm font-semibold text-bip-muted transition-colors hover:text-bip-black sm:text-right"
          @click="handleBackToLogin"
        >
          Voltar ao login
        </button>
      </div>
    </form>

    <p v-if="!mfaToken" class="mt-7 text-center text-sm text-bip-muted">
      Ainda não tem uma conta?
      <RouterLink
        :to="{ name: AuthRouteNames.Register }"
        class="ml-1 font-bold text-bip-black underline-offset-4 hover:underline"
      >
        Criar conta
      </RouterLink>
    </p>

    <template #footer>
      <p class="text-xs leading-5 text-bip-muted">
        Ambiente protegido e monitorado. Use apenas uma conta administrativa autorizada.
      </p>
    </template>
  </AuthShell>
</template>
