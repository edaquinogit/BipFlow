<script setup lang="ts">
import { computed } from 'vue'
import {
  GlobeAltIcon,
} from '@heroicons/vue/24/outline'
import type { PublicMerchantProfile } from '@/types/store'

/**
 * COMMERCE P1 -- discreet storefront footer row for the merchant's website
 * and social links. Renders nothing when the store has filled none of them,
 * so it never adds visual weight to a storefront that hasn't opted in.
 *
 * Every link is validated server-side to be http(s) before it is stored and
 * is only ever echoed through PublicMerchantProfile (never raw HTML); here
 * they open in a new tab with rel="noopener noreferrer".
 */
const props = defineProps<{ merchant: PublicMerchantProfile | null | undefined }>()

const LINKS = [
  { key: 'website_url', label: 'Site' },
  { key: 'instagram_url', label: 'Instagram' },
  { key: 'facebook_url', label: 'Facebook' },
  { key: 'tiktok_url', label: 'TikTok' },
  { key: 'youtube_url', label: 'YouTube' },
] as const

const visibleLinks = computed(() =>
  LINKS.map((link) => ({ ...link, url: props.merchant?.[link.key]?.trim() ?? '' })).filter(
    (link) => /^https?:\/\//i.test(link.url),
  ),
)
</script>

<template>
  <nav
    v-if="visibleLinks.length"
    class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
    aria-label="Redes sociais da loja"
    data-cy="storefront-social-links"
  >
    <a
      v-for="link in visibleLinks"
      :key="link.key"
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7280] transition hover:text-[#05050A]"
    >
      <GlobeAltIcon class="h-3.5 w-3.5" aria-hidden="true" />
      {{ link.label }}
    </a>
  </nav>
</template>
