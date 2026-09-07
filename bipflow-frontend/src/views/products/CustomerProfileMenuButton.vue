<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowRightOnRectangleIcon, UserCircleIcon, UserPlusIcon } from '@heroicons/vue/24/outline'
import { authService } from '@/services/auth.service'
import { useCustomerProfile } from '@/composables/useCustomerProfile'
import { createCustomerProfilePath, customerAccountPath, customerLoginPath } from '@/router/auth.routes'

// Minimalist storefront profile icon: not logged in -> "Entrar"/"Criar
// perfil" menu; logged in with a profile for this store -> straight to
// the account page. Etapa 2 of docs/architecture/customer-profile-
// checkout-evolution.md.
const route = useRoute()
const { hasProfile, fetchCustomerProfile } = useCustomerProfile()

const MENU_WIDTH_PX = 208 // matches the dropdown's w-52

const isMenuOpen = ref(false)
const menuAlignRight = ref(true)
const containerRef = ref<HTMLElement | null>(null)

const storeSlug = computed(() => (
  typeof route.params?.storeSlug === 'string' ? route.params.storeSlug : ''
))

const accountRoute = computed(() => ({ path: customerAccountPath(storeSlug.value) }))

const createProfileRoute = computed(() => ({
  path: createCustomerProfilePath(storeSlug.value),
  query: { redirect: route.fullPath },
}))

const loginRoute = computed(() => ({
  path: customerLoginPath(storeSlug.value),
  query: { redirect: route.fullPath },
}))

function handleIconClick(): void {
  if (authService.isAuthenticated() && hasProfile.value) {
    return // RouterLink below already navigates straight to the account page.
  }

  if (!isMenuOpen.value) {
    updateMenuAlignment()
  }

  isMenuOpen.value = !isMenuOpen.value
}

// The icon's position varies by page (flush against the header's right
// edge on the product detail page, but preceding a wide cart button on the
// catalog page, where it ends up close to the left edge instead). Anchoring
// the dropdown to a fixed side breaks one of the two layouts, so pick
// whichever side actually has room based on the icon's real position.
function updateMenuAlignment(): void {
  const container = containerRef.value
  if (!container) return

  const rect = container.getBoundingClientRect()
  menuAlignRight.value = rect.right >= MENU_WIDTH_PX
}

function closeMenu(): void {
  isMenuOpen.value = false
}

function handleOutsideClick(event: MouseEvent): void {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    closeMenu()
  }
}

onMounted(async () => {
  window.addEventListener('click', handleOutsideClick)

  // Only if not already checked this session: this component remounts
  // fresh on every navigation between the product list and a product
  // detail page, and re-fetching on each one would be wasted work given
  // the singleton cache already answers "hasProfile" for the storefront's
  // display purposes -- CartDrawer's parent view (ProductsView.vue/
  // ProductDetailView.vue) re-fetches for real whenever the cart opens.
  if (authService.isAuthenticated() && hasProfile.value === null) {
    await fetchCustomerProfile()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleOutsideClick)
})
</script>

<template>
  <div ref="containerRef" class="relative">
    <RouterLink
      v-if="authService.isAuthenticated() && hasProfile"
      :to="accountRoute"
      class="storefront-outline-button inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-primary-soft)]"
      aria-label="Minha conta"
      title="Minha conta"
    >
      <UserCircleIcon class="h-5 w-5" aria-hidden="true" />
    </RouterLink>

    <button
      v-else
      type="button"
      class="storefront-outline-button inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--store-primary-soft)]"
      aria-haspopup="menu"
      :aria-expanded="isMenuOpen"
      aria-label="Entrar ou criar perfil"
      title="Entrar ou criar perfil"
      @click="handleIconClick"
    >
      <UserCircleIcon class="h-5 w-5" aria-hidden="true" />
    </button>

    <div
      v-if="isMenuOpen"
      role="menu"
      class="absolute top-[calc(100%+0.5rem)] z-20 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-lg"
      :class="menuAlignRight ? 'right-0' : 'left-0'"
    >
      <RouterLink
        :to="createProfileRoute"
        role="menuitem"
        class="flex min-h-12 items-center gap-2.5 px-4 py-3 text-sm font-semibold text-[#05050A] transition hover:bg-[#FAFAFA] active:bg-[#FAFAFA]"
        @click="closeMenu"
      >
        <UserPlusIcon class="h-5 w-5 shrink-0 text-[#6B7280]" aria-hidden="true" />
        Criar perfil
      </RouterLink>
      <RouterLink
        :to="loginRoute"
        role="menuitem"
        class="flex min-h-12 items-center gap-2.5 border-t border-[#E5E7EB] px-4 py-3 text-sm text-[#6B7280] transition hover:bg-[#FAFAFA] active:bg-[#FAFAFA]"
        @click="closeMenu"
      >
        <ArrowRightOnRectangleIcon class="h-5 w-5 shrink-0 text-[#6B7280]" aria-hidden="true" />
        Entrar
      </RouterLink>
    </div>
  </div>
</template>
