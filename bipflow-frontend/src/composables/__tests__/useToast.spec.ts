import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '../useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToast().clearAll()
  })

  afterEach(() => {
    useToast().clearAll()
    vi.useRealTimers()
  })

  it('deduplicates three quick "added to cart" toasts (same product) into one', () => {
    const { toasts, success } = useToast()

    success('1 unidade(s) de Camiseta adicionada(s) ao pedido.', undefined, 'cart-add')
    success('1 unidade(s) de Camiseta adicionada(s) ao pedido.', undefined, 'cart-add')
    success('1 unidade(s) de Camiseta adicionada(s) ao pedido.', undefined, 'cart-add')

    const cartAddToasts = toasts.value.filter((toast) => toast.message.includes('Camiseta'))
    expect(cartAddToasts).toHaveLength(1)
  })

  it('updates the single toast message when different products are added quickly', () => {
    const { toasts, success } = useToast()

    success('1 unidade(s) de Camiseta adicionada(s) ao pedido.', undefined, 'cart-add')
    success('1 unidade(s) de Calça adicionada(s) ao pedido.', undefined, 'cart-add')

    const cartAddToasts = toasts.value.filter((toast) => toast.key === 'cart-add')
    expect(cartAddToasts).toHaveLength(1)
    expect(cartAddToasts.at(0)?.message).toContain('Calça')
  })

  it('keeps the same toast id across a keyed update (same DOM node, live region announces the change)', () => {
    const { toasts, success } = useToast()

    success('Primeiro item adicionado.', undefined, 'cart-add')
    const firstId = toasts.value.at(0)?.id
    expect(firstId).toBeDefined()

    success('Segundo item adicionado.', undefined, 'cart-add')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value.at(0)?.id).toBe(firstId)
  })

  it('does not dedupe toasts without a key (existing behavior for unrelated success calls)', () => {
    const { toasts, success } = useToast()

    success('Pedido 1001 registrado.')
    success('Pedido 1002 registrado.')

    expect(toasts.value).toHaveLength(2)
  })

  it('does not let a keyed success toast suppress or be suppressed by a checkout error toast', () => {
    const { toasts, success, error } = useToast()

    success('1 unidade(s) de Camiseta adicionada(s) ao pedido.', undefined, 'cart-add')
    error('Não foi possível abrir o WhatsApp da loja. Seu carrinho foi mantido.')

    expect(toasts.value).toHaveLength(2)
    expect(toasts.value.some((toast) => toast.type === 'success')).toBe(true)
    expect(toasts.value.some((toast) => toast.type === 'error')).toBe(true)
  })

  it('shows a success toast followed by an error toast as two independent toasts', () => {
    const { toasts, success, error } = useToast()

    success('Pedido 1001 registrado.')
    error('Falha ao processar.')

    expect(toasts.value.map((toast) => toast.type)).toEqual(['success', 'error'])
  })

  it('restarts the auto-close duration on a keyed update instead of stacking timers', () => {
    const { toasts, success } = useToast()

    success('Primeiro item adicionado.', 2000, 'cart-add')
    vi.advanceTimersByTime(1500)
    // A second add arrives before the first would have closed -- the timer
    // must restart from here, not close 500ms later from the first call.
    success('Segundo item adicionado.', 2000, 'cart-add')

    vi.advanceTimersByTime(1500)
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(600)
    expect(toasts.value).toHaveLength(0)
  })

  it('still auto-removes a keyless toast after its duration', () => {
    const { toasts, success } = useToast()

    success('Pedido 1001 registrado.', 1000)
    expect(toasts.value).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('never keeps more than the visible cap of unrelated (non-deduped) toasts', () => {
    const { toasts, warning } = useToast()

    warning('Aviso 1')
    warning('Aviso 2')
    warning('Aviso 3')
    warning('Aviso 4')

    expect(toasts.value.length).toBeLessThanOrEqual(3)
    expect(toasts.value.at(-1)?.message).toBe('Aviso 4')
  })
})
