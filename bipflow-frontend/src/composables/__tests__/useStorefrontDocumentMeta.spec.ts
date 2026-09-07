import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useStorefrontDocumentMeta } from '../useStorefrontDocumentMeta'

function getDescription(): string {
  return document.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
}

function mountHost(storeName: ReturnType<typeof ref<string | null>>, description = ref<string | null>(null), suffix = ref<string | null>(null)) {
  return mount(
    defineComponent({
      setup() {
        useStorefrontDocumentMeta({ storeName, description, suffix })
        return () => h('div')
      },
    }),
  )
}

describe('useStorefrontDocumentMeta', () => {
  it('sets the document title and description from the store while mounted', async () => {
    const name = ref<string | null>('Boutique Fitness')
    const description = ref<string | null>('Moda fitness com curadoria')
    mountHost(name, description)

    expect(document.title).toBe('Boutique Fitness')
    expect(getDescription()).toBe('Moda fitness com curadoria')
  })

  it('adds a product suffix and reacts to store changes', async () => {
    const name = ref<string | null>('Loja A')
    const suffix = ref<string | null>('Camiseta Preta')
    mountHost(name, ref<string | null>(null), suffix)

    expect(document.title).toBe('Camiseta Preta · Loja A')

    name.value = 'Loja B'
    await Promise.resolve()
    expect(document.title).toBe('Camiseta Preta · Loja B')
  })

  it('restores generic metadata when the storefront view unmounts', async () => {
    const name = ref<string | null>('Loja Que Sai')
    const description = ref<string | null>('desc da loja')
    const wrapper = mountHost(name, description)

    expect(document.title).toBe('Loja Que Sai')
    wrapper.unmount()

    expect(document.title).toBe('BipFlow')
    expect(getDescription()).toBe('Catálogo e pedidos online.')
  })

  it('does not clobber a title another view already set after navigation', async () => {
    const name = ref<string | null>('Loja X')
    const wrapper = mountHost(name)
    expect(document.title).toBe('Loja X')

    // Simulate the router/next view taking over before this one unmounts.
    document.title = 'Painel | BipFlow'
    wrapper.unmount()
    expect(document.title).toBe('Painel | BipFlow')
  })

  it('clamps an overly long description', () => {
    const name = ref<string | null>('Loja Y')
    const description = ref<string | null>('lorem ipsum '.repeat(40))
    mountHost(name, description)
    expect(getDescription().length).toBeLessThanOrEqual(160)
  })
})
