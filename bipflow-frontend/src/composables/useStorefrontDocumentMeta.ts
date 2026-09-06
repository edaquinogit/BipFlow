import { onScopeDispose, watch, type Ref } from 'vue'

/**
 * Keeps `document.title` and `<meta name="description">` in sync with the
 * store currently shown in the storefront, and -- crucially -- restores the
 * generic document metadata when the storefront view is left, so a visitor
 * navigating from Store A's catalog to another area never keeps Store A's
 * name in the tab or in shared-link previews.
 *
 * The static document ships with generic values (see index.html); this
 * composable owns them only while a storefront view is mounted.
 */

const GENERIC_TITLE = 'BipFlow'
const GENERIC_DESCRIPTION = 'Catálogo e pedidos online.'
const MAX_DESCRIPTION_LENGTH = 160

export interface StorefrontMetaInput {
  storeName: Ref<string | null | undefined>
  description: Ref<string | null | undefined>
  suffix?: Ref<string | null | undefined>
}

function findDescriptionTag(): HTMLMetaElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  return document.querySelector<HTMLMetaElement>('meta[name="description"]')
}

function setDescription(value: string): void {
  const tag = findDescriptionTag()
  if (tag) {
    tag.setAttribute('content', value)
    return
  }
  if (typeof document === 'undefined') {
    return
  }
  const created = document.createElement('meta')
  created.setAttribute('name', 'description')
  created.setAttribute('content', value)
  document.head.appendChild(created)
}

function clampDescription(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= MAX_DESCRIPTION_LENGTH) {
    return collapsed
  }
  return `${collapsed.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`
}

export function useStorefrontDocumentMeta(input: StorefrontMetaInput): void {
  if (typeof document === 'undefined') {
    return
  }

  let lastAppliedTitle: string | null = null
  let lastAppliedDescription: string | null = null

  function apply(): void {
    const name = input.storeName.value?.trim()
    const suffix = input.suffix?.value?.trim()

    // Before a store resolves, leave whatever the router set in place rather
    // than flashing a generic title.
    if (!name) {
      return
    }

    const nextTitle = suffix ? `${suffix} · ${name}` : name
    const rawDescription = input.description.value?.trim()
    const nextDescription = rawDescription
      ? clampDescription(rawDescription)
      : `Catálogo e pedidos de ${name}.`

    document.title = nextTitle
    lastAppliedTitle = nextTitle
    setDescription(nextDescription)
    lastAppliedDescription = nextDescription
  }

  function restore(): void {
    // Only reset what we still own -- if the router or another view has
    // already set a fresh title/description for the next area, leave it be.
    if (document.title === lastAppliedTitle) {
      document.title = GENERIC_TITLE
    }
    if (findDescriptionTag()?.getAttribute('content') === lastAppliedDescription) {
      setDescription(GENERIC_DESCRIPTION)
    }
  }

  watch(
    () => [input.storeName.value, input.description.value, input.suffix?.value],
    apply,
    { immediate: true },
  )

  onScopeDispose(restore)
}
