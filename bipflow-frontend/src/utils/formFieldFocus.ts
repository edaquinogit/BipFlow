/**
 * Ciclo 8 -- checkout details polish.
 *
 * Small, framework-free mapping between "which form fields are currently
 * applicable/invalid" and "which DOM element should receive focus first".
 * Deliberately generic over a plain descriptor array so it can be unit
 * tested without mounting a component.
 */
export interface FocusableFormField {
  /** Stable identifier, only used for debugging/tests -- not read here. */
  key: string
  /** Whether this field is part of the current scenario (rendered, not superseded by profile data). */
  applicable: boolean
  /** Whether the field's value currently fails an already-existing business rule. */
  invalid: boolean
  /** The input/select/textarea to focus, or null if not yet mounted. */
  element: HTMLElement | null
}

function isDisabledFormControl(element: HTMLElement): boolean {
  return (
    (element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement)
    && element.disabled
  )
}

/**
 * First field that is both applicable and invalid, has a mounted element,
 * and is not disabled -- in the order the caller supplies (visual order).
 * Never returns a hidden/inapplicable/disabled field.
 */
export function findFirstInvalidField(
  fields: FocusableFormField[],
): FocusableFormField | null {
  return (
    fields.find(
      (field) =>
        field.applicable
        && field.invalid
        && field.element !== null
        && !isDisabledFormControl(field.element),
    ) ?? null
  )
}

/**
 * Move focus to `element` and, only when necessary, scroll it into view --
 * instantly when the user asked for reduced motion, smoothly otherwise.
 */
export function focusAndRevealField(
  element: HTMLElement,
  options: { reduceMotion: boolean },
): void {
  element.focus({ preventScroll: true })
  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({
      behavior: options.reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    })
  }
}
