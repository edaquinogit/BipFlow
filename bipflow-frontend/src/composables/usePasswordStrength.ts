import { computed, type Ref } from 'vue'

export interface PasswordRule {
  label: string
  passed: boolean
}

export type PasswordStrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong'

const STRENGTH_LABELS: Record<PasswordStrengthLevel, string> = {
  empty: '',
  weak: 'Fraca',
  fair: 'Razoável',
  good: 'Boa',
  strong: 'Forte',
}

// Password feedback follows the semantic state palette. Brand accents stay
// reserved for identity and focus, so a weak password reads unambiguously.
const STRENGTH_BAR_CLASSES: Record<PasswordStrengthLevel, string> = {
  empty: 'bg-zinc-200',
  weak: 'bg-danger',
  fair: 'bg-amber-400',
  good: 'bg-emerald-400',
  strong: 'bg-emerald-600',
}

/**
 * Best-effort client-side mirror of two of Django's AUTH_PASSWORD_VALIDATORS
 * (MinimumLengthValidator, NumericPasswordValidator) plus two readability
 * heuristics (letter + number present). The backend's validate_password()
 * remains the authoritative check -- this never replicates
 * CommonPasswordValidator (needs a large dictionary) or
 * UserAttributeSimilarityValidator (needs fuzzy-matching against the
 * username/email), so a password can still look "strong" here and be
 * rejected server-side for one of those two reasons. That's an accepted
 * gap, not a bug: real-time hints, not a guarantee.
 */
export function usePasswordStrength(password: Ref<string>) {
  const rules = computed<PasswordRule[]>(() => [
    { label: 'No mínimo 8 caracteres', passed: password.value.length >= 8 },
    { label: 'Contém uma letra', passed: /[A-Za-z]/.test(password.value) },
    { label: 'Contém um número', passed: /\d/.test(password.value) },
    { label: 'Não é só números', passed: password.value.length > 0 && !/^\d+$/.test(password.value) },
  ])

  const passedCount = computed(() => rules.value.filter((rule) => rule.passed).length)
  const totalRules = rules.value.length

  const level = computed<PasswordStrengthLevel>(() => {
    if (!password.value) return 'empty'

    const ratio = passedCount.value / totalRules
    if (ratio < 0.5) return 'weak'
    if (ratio < 0.75) return 'fair'
    if (ratio < 1) return 'good'
    return 'strong'
  })

  const label = computed(() => STRENGTH_LABELS[level.value])
  const barClass = computed(() => STRENGTH_BAR_CLASSES[level.value])
  const filledBars = computed(() => (level.value === 'empty' ? 0 : passedCount.value))
  const isValid = computed(() => rules.value.every((rule) => rule.passed))

  return { rules, level, label, barClass, filledBars, totalBars: totalRules, isValid }
}
