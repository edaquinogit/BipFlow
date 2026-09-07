<script setup lang="ts">
import { computed } from 'vue'
import { useCarouselAutoplay } from '@/composables/useCarouselAutoplay'
import { handleProductImageError } from '@/utils/productImagePlaceholder'
import type { PublicStorefrontBanner } from '@/types/store'

/**
 * Main storefront carousel (Ciclo 9). Auto-advances every ~6s through the
 * merchant's hero banners; a single banner renders statically with no
 * controls. Stable slot: fixed aspect ratio, no CLS, no layout jump when
 * banners load or when there is only one.
 */
const props = defineProps<{
  banners: PublicStorefrontBanner[]
  storeName: string
}>()

const slideCount = computed(() => props.banners.length)
const { activeIndex, isAutoplaying, goTo, pause, resume } = useCarouselAutoplay({
  slideCount,
  intervalMs: 6000,
})

const hasControls = computed(() => props.banners.length > 1)
const activeBanner = computed(() => props.banners[activeIndex.value] ?? null)
const activeBannerHasCopy = computed(() => {
  const banner = activeBanner.value
  if (!banner) return false
  return Boolean(banner.title || banner.subtitle || (banner.cta_text && banner.button_url))
})

function slideLabel(index: number): string {
  return `Ir para o banner ${index + 1} de ${props.banners.length}`
}
</script>

<template>
  <section
    v-if="banners.length"
    data-cy="storefront-hero-banner"
    class="relative mb-5 overflow-hidden rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-surface)] sm:mb-6"
    :aria-roledescription="hasControls ? 'carrossel' : undefined"
    @mouseenter="pause"
    @mouseleave="resume"
    @focusin="pause"
    @focusout="resume"
  >
    <div class="relative aspect-[16/7] w-full overflow-hidden">
      <template v-for="(banner, index) in banners" :key="`${banner.position}-${banner.image_url}`">
        <Transition name="hero-slide">
          <div
            v-show="index === activeIndex"
            class="absolute inset-0"
            :aria-hidden="index === activeIndex ? undefined : 'true'"
          >
            <component
              :is="banner.button_url ? 'a' : 'div'"
              :href="banner.button_url || undefined"
              class="block h-full w-full"
              :tabindex="index === activeIndex ? undefined : -1"
            >
              <picture>
                <source
                  v-if="banner.image_url_mobile"
                  :srcset="banner.image_url_mobile"
                  media="(max-width: 640px)"
                />
                <img
                  :src="banner.image_url"
                  :alt="banner.alt_text || storeName"
                  class="h-full w-full object-cover"
                  :loading="index === 0 ? 'eager' : 'lazy'"
                  :fetchpriority="index === 0 ? 'high' : 'auto'"
                  @error="handleProductImageError"
                />
              </picture>
            </component>
          </div>
        </Transition>
      </template>
    </div>

    <div
      v-if="activeBanner && activeBannerHasCopy"
      class="flex flex-col gap-3 border-t border-[var(--store-border)] px-4 py-4 min-[390px]:px-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        <h2
          v-if="activeBanner.title"
          class="text-lg font-semibold leading-tight text-[var(--store-text)] min-[390px]:text-xl"
        >
          {{ activeBanner.title }}
        </h2>
        <p
          v-if="activeBanner.subtitle"
          class="mt-1 text-sm leading-5 text-[var(--store-text-muted)]"
        >
          {{ activeBanner.subtitle }}
        </p>
      </div>

      <a
        v-if="activeBanner.cta_text && activeBanner.button_url"
        :href="activeBanner.button_url"
        target="_blank"
        rel="noopener"
        class="storefront-primary-button inline-flex h-11 shrink-0 items-center justify-center rounded-[var(--store-radius-md)] px-4 text-[0.8125rem] font-semibold uppercase tracking-wide focus:outline-none"
      >
        {{ activeBanner.cta_text }}
      </a>
    </div>

    <div
      v-if="hasControls"
      class="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2"
      role="tablist"
      aria-label="Banners principais"
    >
      <button
        v-for="(banner, index) in banners"
        :key="`dot-${banner.position}-${banner.image_url}`"
        type="button"
        role="tab"
        :aria-selected="index === activeIndex"
        :aria-label="slideLabel(index)"
        class="h-2.5 min-h-11 min-w-11 rounded-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        @click="goTo(index)"
      >
        <span
          class="mx-auto block h-2.5 w-2.5 rounded-full transition-colors"
          :class="index === activeIndex ? 'bg-white' : 'bg-white/50'"
        />
      </button>
    </div>

    <span v-if="isAutoplaying" class="sr-only">Carrossel avancando automaticamente.</span>
  </section>
</template>

<style scoped>
.hero-slide-enter-active,
.hero-slide-leave-active {
  transition: opacity 500ms ease, transform 500ms ease;
}
.hero-slide-enter-from {
  opacity: 0;
  transform: translateX(2%);
}
.hero-slide-leave-to {
  opacity: 0;
  transform: translateX(-2%);
}

@media (prefers-reduced-motion: reduce) {
  .hero-slide-enter-active,
  .hero-slide-leave-active {
    transition: opacity 1ms linear;
  }
  .hero-slide-enter-from,
  .hero-slide-leave-to {
    transform: none;
  }
}
</style>
