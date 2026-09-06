import { describe, expect, it, vi } from 'vitest'
import { findFirstInvalidField, focusAndRevealField, type FocusableFormField } from '../formFieldFocus'

function makeInput(disabled = false): HTMLInputElement {
  const input = document.createElement('input')
  input.disabled = disabled
  return input
}

describe('findFirstInvalidField', () => {
  it('returns the first field that is applicable, invalid and mounted', () => {
    const fields: FocusableFormField[] = [
      { key: 'a', applicable: true, invalid: false, element: makeInput() },
      { key: 'b', applicable: true, invalid: true, element: makeInput() },
      { key: 'c', applicable: true, invalid: true, element: makeInput() },
    ]

    expect(findFirstInvalidField(fields)?.key).toBe('b')
  })

  it('skips a field that is invalid but not applicable (hidden/superseded)', () => {
    const fields: FocusableFormField[] = [
      { key: 'hidden', applicable: false, invalid: true, element: makeInput() },
      { key: 'visible', applicable: true, invalid: true, element: makeInput() },
    ]

    expect(findFirstInvalidField(fields)?.key).toBe('visible')
  })

  it('skips a field with no mounted element', () => {
    const fields: FocusableFormField[] = [
      { key: 'unmounted', applicable: true, invalid: true, element: null },
      { key: 'mounted', applicable: true, invalid: true, element: makeInput() },
    ]

    expect(findFirstInvalidField(fields)?.key).toBe('mounted')
  })

  it('skips a disabled field', () => {
    const fields: FocusableFormField[] = [
      { key: 'disabled', applicable: true, invalid: true, element: makeInput(true) },
      { key: 'enabled', applicable: true, invalid: true, element: makeInput() },
    ]

    expect(findFirstInvalidField(fields)?.key).toBe('enabled')
  })

  it('returns null when nothing qualifies', () => {
    const fields: FocusableFormField[] = [
      { key: 'a', applicable: true, invalid: false, element: makeInput() },
      { key: 'b', applicable: false, invalid: true, element: makeInput() },
    ]

    expect(findFirstInvalidField(fields)).toBeNull()
  })
})

describe('focusAndRevealField', () => {
  it('focuses the element and scrolls smoothly when motion is allowed', () => {
    const element = makeInput()
    const focusSpy = vi.spyOn(element, 'focus')
    const scrollSpy = vi.fn()
    element.scrollIntoView = scrollSpy

    focusAndRevealField(element, { reduceMotion: false })

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('scrolls instantly when the user prefers reduced motion', () => {
    const element = makeInput()
    const scrollSpy = vi.fn()
    element.scrollIntoView = scrollSpy

    focusAndRevealField(element, { reduceMotion: true })

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })
})
