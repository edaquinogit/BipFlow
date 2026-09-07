<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthAlert from '@/components/auth/AuthAlert.vue'
import AuthField from '@/components/auth/AuthField.vue'
import AuthSubmitButton from '@/components/auth/AuthSubmitButton.vue'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { AuthRouteNames, createCustomerProfilePath } from '@/router/auth.routes'
import { PublicRoutes } from '@/router/public.routes'
import { authService } from '@/services/auth.service'
import { setSelectedStoreSlug } from '@/services/store-scope'
import { isAxiosError } from '@/types/errors'

// Customer authentication intentionally keeps its storefront language and
// destination separate from the administrative Bip Flow login.
const route = useRoute()
const router = useRouter()
const routeStoreSlug = typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
if (routeStoreSlug) setSelectedStoreSlug(routeStoreSlug)

const { fetchCustomerProfile } = useCustomerProfile()

const email = ref('')
const password = ref('')
const emailError = ref('')
const passwordError = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')

const sessionNotice = computed(() => {
  switch (route.query.reason) {
    case 'session_expired':
      return 'Sua sessão expirou. Entre novamente para continuar.'
    case 'customer_auth_required':
      return 'Entre na sua conta para continuar.'
    default:
      return ''
  }
})

function validateForm(): boolean {
  emailError.value = ''
  passwordError.value = ''

  const normalizedEmail = email.value.trim()
  if (!normalizedEmail) {
    emailError.value = 'Informe seu email.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    emailError.value = 'Informe um email válido.'
  }

  if (!password.value) passwordError.value = 'Informe sua senha.'
  return !emailError.value && !passwordError.value
}

function extractErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 401) return 'Email ou senha inválidos.'
    if (error.response?.status === 429) return 'Muitas tentativas. Aguarde um momento e tente novamente.'
    if (!error.response) return 'Falha de conexão. Verifique sua internet e tente novamente.'
  }

  return 'Não foi possível entrar agora. Tente novamente.'
}

function redirectAfterLogin(): void {
  const redirectTarget = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  if (redirectTarget) {
    void router.push(redirectTarget)
    return
  }

  void router.push(
    routeStoreSlug
      ? { name: PublicRoutes.StoreProducts, params: { storeSlug: routeStoreSlug } }
      : { name: PublicRoutes.Products }
  )
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = ''
  if (!validateForm()) return

  isSubmitting.value = true

  try {
    const result = await authService.login({
      email: email.value.trim().toLowerCase(),
      password: password.value,
    })

    if ('mfa_required' in result) {
      errorMessage.value = 'Esta conta exige verificação em duas etapas. Acesse pelo painel administrativo.'
      return
    }

    await fetchCustomerProfile()
    redirectAfterLogin()
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="storefront-shell customer-auth-shell relative min-h-screen min-h-dvh overflow-hidden bg-[#fafafa]">
    <div class="customer-auth-grid" aria-hidden="true" />
    <div class="customer-auth-glow" aria-hidden="true" />

    <div class="relative z-10 mx-auto flex min-h-screen min-h-dvh max-w-lg flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
      <section class="rounded-[1.75rem] border border-[#e5e7eb] bg-white p-6 shadow-[0_24px_70px_-38px_rgba(5,5,10,0.45)] sm:p-9">
        <div class="mb-8 flex items-center justify-center gap-3">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white p-1 shadow-sm">
            <img src="/brand/bipflow-logo-auth.webp" alt="" class="h-full w-full object-contain" aria-hidden="true" />
          </span>
          <span class="text-lg font-extrabold tracking-[-0.045em] text-[#05050a]">Bip Flow</span>
        </div>

        <header class="mb-7 text-center">
          <p class="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#d60073]">Minha conta</p>
          <h1 class="mt-2 text-[2rem] font-extrabold tracking-[-0.045em] text-[#05050a]">Que bom ter você aqui</h1>
          <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#6b7280]">
            Entre no seu perfil para acompanhar e finalizar pedidos com mais agilidade.
          </p>
        </header>

        <div class="mb-5 grid gap-3">
          <AuthAlert v-if="sessionNotice" data-cy="session-notice" tone="info">
            {{ sessionNotice }}
          </AuthAlert>
          <AuthAlert v-if="errorMessage" data-cy="login-error" tone="error">
            {{ errorMessage }}
          </AuthAlert>
        </div>

        <form class="space-y-1" novalidate @submit.prevent="handleSubmit">
          <AuthField
            id="customer-email"
            v-model="email"
            name="email"
            label="Email"
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="voce@email.com"
            :error="emailError"
            data-cy="customer-login-email"
            @input="emailError = ''"
          />

          <AuthField
            id="customer-password"
            v-model="password"
            name="password"
            label="Senha"
            type="password"
            autocomplete="current-password"
            placeholder="Digite sua senha"
            :error="passwordError"
            data-cy="customer-login-password"
            @input="passwordError = ''"
          >
            <template #labelAction>
              <RouterLink
                :to="{ name: AuthRouteNames.ForgotPassword }"
                class="text-xs font-semibold text-[#111827] underline-offset-4 hover:underline"
              >
                Esqueci minha senha
              </RouterLink>
            </template>
          </AuthField>

          <div class="pt-2">
            <AuthSubmitButton :loading="isSubmitting" loading-label="Entrando...">
              Entrar na minha conta
            </AuthSubmitButton>
          </div>
        </form>

        <p class="mt-7 text-center text-sm text-[#6b7280]">
          Ainda não tem perfil?
          <RouterLink
            :to="{ path: createCustomerProfilePath(routeStoreSlug), query: route.query.redirect ? { redirect: route.query.redirect } : {} }"
            class="ml-1 font-bold text-[#111827] underline-offset-4 hover:underline"
          >
            Criar agora
          </RouterLink>
        </p>
      </section>

      <p class="mt-5 text-center text-xs leading-5 text-[#6b7280]">
        Seus dados são usados apenas para facilitar sua experiência de compra.
      </p>
    </div>
  </main>
</template>

<style scoped>
.customer-auth-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(17, 24, 39, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(17, 24, 39, 0.035) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(circle at 50% 45%, black, transparent 74%);
}

.customer-auth-glow {
  position: absolute;
  top: -12rem;
  left: 50%;
  width: 34rem;
  height: 34rem;
  transform: translateX(-50%);
  border-radius: 9999px;
  background: radial-gradient(circle, rgba(255, 0, 140, 0.06), transparent 68%);
}
</style>
