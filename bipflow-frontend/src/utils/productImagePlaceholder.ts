/**
 * Single source of truth for the "no product image yet" placeholder.
 *
 * The same inline SVG data URI used to be pasted into ProductCard.vue and
 * ProductDetailView.vue; keeping one copy here avoids the two drifting and
 * lets tests assert a stable value. It is a neutral 4:5 illustration -- no
 * external request, no layout shift (callers reserve the ratio with
 * `aspect-ratio` / an `aspect-[4/5]` box).
 */
const PLACEHOLDER_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 800">
    <rect width="640" height="800" fill="#FAFAFA"/>
    <rect x="96" y="128" width="448" height="544" rx="36" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="2"/>
    <path d="M222 330h196c18 0 32 14 32 32v118c0 18-14 32-32 32H222c-18 0-32-14-32-32V362c0-18 14-32 32-32z" fill="#F3F4F6"/>
    <path d="M236 462l52-54c10-10 26-10 36 0l34 35 18-19c10-11 28-11 38 0l58 60v28H236z" fill="#D1D5DB"/>
    <circle cx="276" cy="382" r="22" fill="#111827" opacity=".16"/>
    <text x="320" y="592" text-anchor="middle" fill="#6B7280" font-family="Arial, sans-serif" font-size="26" font-weight="700">Imagem em breve</text>
  </svg>
`

export const PRODUCT_IMAGE_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(PLACEHOLDER_SVG)}`

/** Resolve a usable image URL, falling back to the shared placeholder. */
export function resolveProductImage(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return PRODUCT_IMAGE_PLACEHOLDER
}

/** `<img @error>` handler that swaps a broken image for the placeholder once. */
export function handleProductImageError(event: Event): void {
  const img = event.target as HTMLImageElement | null
  if (img && img.src !== PRODUCT_IMAGE_PLACEHOLDER) {
    img.src = PRODUCT_IMAGE_PLACEHOLDER
  }
}
