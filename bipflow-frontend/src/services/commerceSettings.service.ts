import api from './api'
import { Logger } from './logger'
import {
  CommerceSettingsSchema,
  PublicCommerceSettingsSchema,
  type CommerceSettings,
  type CommerceSettingsPayload,
  type PublicCommerceSettings,
} from '@/schemas/commerceSettings.schema'

/**
 * Per-store commercial rules (online-sales foundation).
 *
 * All storefront/dashboard reads go through this service -- no component
 * calls the commerce-settings endpoints with axios directly. Responses are
 * validated with zod (safeParse + fallback to the raw payload on drift, same
 * pattern as stockMovement.service.ts) so a backend contract change surfaces
 * as a logged warning, never a silent render break.
 */

const CURRENT_ENDPOINT = 'v1/store/current/commerce-settings/'

function publicEndpoint(slug: string): string {
  return `v1/public/stores/${encodeURIComponent(slug)}/commerce-settings/`
}

export const commerceSettingsService = {
  /** Dashboard: the resolved store's commercial rules. */
  async get(): Promise<CommerceSettings> {
    const { data } = await api.get<unknown>(CURRENT_ENDPOINT)
    const parsed = CommerceSettingsSchema.safeParse(data)
    if (!parsed.success) {
      Logger.warn('Commerce settings response failed validation', {
        issues: parsed.error.issues,
      })
      return data as CommerceSettings
    }
    return parsed.data
  },

  /** Dashboard: partial update (owner/manager only, enforced server-side). */
  async update(payload: CommerceSettingsPayload): Promise<CommerceSettings> {
    const { data } = await api.patch<unknown>(CURRENT_ENDPOINT, payload)
    const parsed = CommerceSettingsSchema.safeParse(data)
    if (!parsed.success) {
      Logger.warn('Commerce settings update response failed validation', {
        issues: parsed.error.issues,
      })
      return data as CommerceSettings
    }
    return parsed.data
  },

  /** Storefront: the sanitised commercial rules for one store's vitrine. */
  async getPublic(slug: string): Promise<PublicCommerceSettings> {
    const { data } = await api.get<unknown>(publicEndpoint(slug))
    const parsed = PublicCommerceSettingsSchema.safeParse(data)
    if (!parsed.success) {
      Logger.warn('Public commerce settings response failed validation', {
        slug,
        issues: parsed.error.issues,
      })
      return data as PublicCommerceSettings
    }
    return parsed.data
  },
}
