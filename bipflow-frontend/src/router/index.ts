
import { createRouter, createWebHistory, type RouteRecordRaw, type RouterScrollBehavior } from 'vue-router'
import { authRoutes, AuthRouteNames, customerLoginPath } from './auth.routes'
import { dashboardRoutes, DashboardRoutes } from './dashboard.routes'
import { errorRoutes } from './error.routes'
import { publicRoutes } from './public.routes'
import { systemRoutes } from './system.routes'
import { authService } from '@/services/auth.service'
import { ensureAuthBooted } from '@/services/api'
import { Logger } from '@/services/logger'

/**
 * 🔀 Route Aggregation
 * Estrutura flat para performance máxima do matcher.
 */
const routes: RouteRecordRaw[] = [
  ...authRoutes,
  ...dashboardRoutes,
  ...errorRoutes,
  ...systemRoutes,
  ...publicRoutes
]

/**
 * Regression (Ciclo 9): a query-only navigation on the same page -- category,
 * search, stock filter or page number changes on /produtos -- used to force
 * `{ top: 0 }` because it has no `savedPosition` and no hash, same as a real
 * cross-page navigation. `to.path` ignores the query string, so comparing it
 * to `from.path` is what tells the two apart: only a real path change (a
 * genuine "go to another page", including a different store's `/l/:slug`
 * path) still scrolls to top; a same-path query change now preserves scroll.
 */
export const resolveScrollBehavior: RouterScrollBehavior = (to, from, savedPosition) => {
  // Se houver posição salva (ex: botão voltar), retorna para ela
  if (savedPosition) return savedPosition
  // Se a rota tiver um hash (ex: #contato), foca no elemento
  if (to.hash) return { el: to.hash, behavior: 'smooth' }
  // Mesma rota (só a query mudou -- filtros, categoria, busca, paginação):
  // preserva a posição atual.
  if (to.path === from.path) return false
  // Navegação real para outra pagina: topo da página
  return { top: 0, behavior: 'smooth' }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: resolveScrollBehavior,
})

/**
 * 🛡️ Navigation Guard (Enterprise Pattern)
 * Implementação limpa sem 'next()', seguindo o padrão moderno do Vue Router 4.
 * Added deadlock prevention and loading state bypass for resilience.
 */
const CHUNK_RELOAD_STORAGE_KEY = 'bipflow:chunk-reload-attempted'
const CHUNK_LOAD_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
]

router.onError((error) => {
  const message = error instanceof Error ? error.message : String(error)
  const isChunkLoadError = CHUNK_LOAD_ERROR_PATTERNS.some((pattern) =>
    message.includes(pattern)
  )

  if (!isChunkLoadError) {
    return
  }

  if (sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === '1') {
    Logger.error('Dynamic route chunk failed after reload attempt', { message })
    return
  }

  sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, '1')
  window.location.reload()
})

router.beforeEach(async (to) => {
  // Restores the in-memory access token from the httpOnly refresh cookie on
  // first load. Public storefront pages only attempt this when a non-sensitive
  // client hint says a session may exist, keeping anonymous catalog visits from
  // generating expected-but-noisy refresh 400s in the backend logs.
  await ensureAuthBooted({
    force: Boolean(to.meta.requiresAuth || to.meta.requiresCustomerAuth || to.meta.guestOnly),
  })
  const isLogged = authService.isAuthenticated()

  // NOTE: there used to be a blanket "always allow navigation to /login"
  // early-return here, justified as deadlock prevention. It was dead code
  // protecting against a loop that can't happen -- /login has no
  // requiresAuth meta, so an unauthenticated visit already falls through
  // to `return true` at the bottom on its own -- and it had the side
  // effect of unconditionally skipping the guestOnly check below for
  // EVERY visit to /login, so an already-authenticated user revisiting
  // /login was never redirected back to the dashboard. Removed rather
  // than special-cased further: the requiresAuth/guestOnly checks already
  // handle /login correctly in both the authenticated and unauthenticated
  // case without it.

  // 1. Proteção de Rotas Privadas (Requires Auth)
  if (to.meta.requiresAuth && !isLogged) {
    if (import.meta.env.DEV) {
      Logger.info("Redirecting unauthenticated user to login", {
        path: to.fullPath,
        isAuthenticated: isLogged,
      })
    }

    return {
      name: AuthRouteNames.Login,
      query: { redirect: to.fullPath, reason: 'auth_required' }
    }
  }

  // 1.1. Conta do cliente da vitrine: exige autenticação, mas redireciona
  // para o login do cliente da loja atual, nunca para o painel admin.
  if (to.meta.requiresCustomerAuth && !isLogged) {
    const storeSlug = typeof to.params.storeSlug === 'string' ? to.params.storeSlug : ''

    return {
      path: customerLoginPath(storeSlug),
      query: { redirect: to.fullPath, reason: 'customer_auth_required' }
    }
  }

  // 2. Proteção de Rotas de Convidados (Guest Only - Login/Register)
  if (to.meta.guestOnly && isLogged) {
    return { name: DashboardRoutes.Overview }
  }

  // 3. Telemetria em modo Desenvolvimento
  if (import.meta.env.DEV) {
    const moduleName = to.meta.module || 'system'
    Logger.info("Navigating to route", {
      routeName: String(to.name),
      module: moduleName,
    })
  }

  // Se nenhuma condição acima for atendida, a navegação flui naturalmente
  return true
})

/**
 * 🏁 Global After Hooks
 */
router.afterEach((to) => {
  sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)

  // Define o título da página dinamicamente. O <title> estático do index.html
  // ("BipFlow Manage — Gestão multiloja e vitrine digital") é o que os crawlers
  // sem JS enxergam; isto ajusta apenas a aba do navegador após a montagem.
  const title = to.meta.title as string | undefined
  document.title = title
    ? `${title} | BipFlow Manage`
    : 'BipFlow Manage — Gestão multiloja e vitrine digital'
})

export default router
