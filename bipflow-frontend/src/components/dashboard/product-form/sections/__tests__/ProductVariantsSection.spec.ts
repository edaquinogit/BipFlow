import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProductVariantsSection from '../ProductVariantsSection.vue'
import { compressImageFile } from '@/utils/image'

vi.mock('@/utils/image', () => ({
  compressImageFile: vi.fn(async (file: File) => file),
}))

const baseVariant = {
  id: 1,
  name: 'M',
  color_hex: '#111827',
  price: null as number | null,
  stock_quantity: 3,
  image: null,
  is_active: true,
  position: 0,
}

function mountSection(price: number | null = null) {
  return mount(ProductVariantsSection, {
    props: {
      variants: [{ ...baseVariant, price }],
      basePrice: 59.9,
    },
  })
}

describe('ProductVariantsSection', () => {
  it('shows the product base price as guidance', () => {
    expect(mountSection().text()).toContain('Preço base do produto')
    expect(mountSection().text()).toContain('59,90')
  })

  it('leaves the price input blank for an inheriting variant', () => {
    const input = mountSection(null).find('input[type="number"][step="0.01"]')
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('pre-fills the input for a variant with its own price', () => {
    const input = mountSection(69.9).find('input[type="number"][step="0.01"]')
    expect((input.element as HTMLInputElement).value).toBe('69.9')
  })

  it('emits a numeric price when the merchant types one', async () => {
    const wrapper = mountSection(null)
    await wrapper.find('input[type="number"][step="0.01"]').setValue('64.90')

    const emitted = wrapper.emitted('update:variants')?.at(-1)?.[0] as Array<{ price: unknown }>
    expect(emitted[0]?.price).toBe(64.9)
  })

  it('emits null (inherit) when the price input is cleared', async () => {
    const wrapper = mountSection(69.9)
    await wrapper.find('input[type="number"][step="0.01"]').setValue('')

    const emitted = wrapper.emitted('update:variants')?.at(-1)?.[0] as Array<{ price: unknown }>
    expect(emitted[0]?.price).toBeNull()
  })

  it('keeps a negative value so form validation can reject it', async () => {
    const wrapper = mountSection(null)
    await wrapper.find('input[type="number"][step="0.01"]').setValue('-5')

    const emitted = wrapper.emitted('update:variants')?.at(-1)?.[0] as Array<{ price: unknown }>
    expect(emitted[0]?.price).toBe(-5)
  })

  it('resolves a non-numeric value to inherit', async () => {
    const wrapper = mountSection(69.9)
    await wrapper.find('input[type="number"][step="0.01"]').setValue('abc')

    const emitted = wrapper.emitted('update:variants')?.at(-1)?.[0] as Array<{ price: unknown }>
    expect(emitted[0]?.price).toBeNull()
  })

  describe('image upload and removal (Ciclo 9)', () => {
    afterEach(() => {
      document.body.innerHTML = ''
      vi.mocked(compressImageFile).mockReset()
      vi.mocked(compressImageFile).mockImplementation(async (file: File) => file)
    })

    function mountWithImage(image: string | File | null) {
      return mount(ProductVariantsSection, {
        attachTo: document.body,
        props: {
          variants: [{ ...baseVariant, image }],
          basePrice: 59.9,
        },
      })
    }

    it('marks a File not yet saved as "Novo", and a persisted URL string as not new', () => {
      const savedWrapper = mountWithImage('https://example.com/m.jpg')
      expect(savedWrapper.text()).not.toContain('Novo')

      const unsavedWrapper = mountWithImage(new File(['x'], 'm.png', { type: 'image/png' }))
      expect(unsavedWrapper.text()).toContain('Novo')
    })

    it('asks for confirmation before removing a saved image, and only removes it once confirmed', async () => {
      const wrapper = mountWithImage('https://example.com/m.jpg')

      await wrapper.find('button[aria-label^="Remover imagem"]').trigger('click')
      expect(document.body.textContent).toContain('Remover imagem')
      expect(wrapper.emitted('update:variants')).toBeFalsy()

      const confirmButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Remover imagem')
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()

      const emitted = wrapper.emitted('update:variants')?.at(-1)?.[0] as Array<{ image: unknown }>
      expect(emitted[0]?.image).toBeNull()
    })

    it('keeps the image when the removal confirmation is cancelled', async () => {
      const wrapper = mountWithImage('https://example.com/m.jpg')

      await wrapper.find('button[aria-label^="Remover imagem"]').trigger('click')
      const cancelButton = Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Cancelar')
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()

      expect(wrapper.emitted('update:variants')).toBeFalsy()
      expect(document.body.textContent).not.toContain('Remover imagem?')
    })

    it('shows a processing failure next to the specific variant, without touching the other variants', async () => {
      vi.mocked(compressImageFile).mockRejectedValueOnce(new Error('Falha ao processar a imagem.'))

      const wrapper = mount(ProductVariantsSection, {
        attachTo: document.body,
        props: {
          variants: [
            { ...baseVariant, id: 1, name: 'M' },
            { ...baseVariant, id: 2, name: 'G' },
          ],
          basePrice: 59.9,
        },
      })

      const firstFileInput = wrapper.findAll('input[type="file"]')[0]!
      const file = new File(['x'], 'quebrada.png', { type: 'image/png' })
      Object.defineProperty(firstFileInput.element, 'files', { value: [file] })
      await firstFileInput.trigger('change')
      await flushPromises()

      expect(wrapper.text()).toContain('Falha ao processar a imagem.')
      // The second variant's own upload field must not report an error.
      const rows = wrapper.findAll('.rounded-xl.border.border-\\[\\#E5E7EB\\].bg-white.p-3')
      expect(rows[1]?.text()).not.toContain('Falha ao processar a imagem.')
    })
  })
})
