<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useAsyncResource } from '@/composables/useAsyncResource';
import { useCurrentStore } from '@/composables/useCurrentStore';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import { useCurrentUser } from '@/composables/useCurrentUser';
import { useToast } from '@/composables/useToast';
import { Logger } from '@/services/logger';
import { storeService } from '@/services/store.service';
import { buildErrorContext, isAxiosError, type ApplicationError } from '@/types/errors';
import type {
  BrazilianUf,
  MerchantProfile,
  MerchantProfilePayload,
} from '@/types/store';

/**
 * COMMERCE P1 -- Merchant Profile. One settings tab, four cards (identity /
 * contact / address / links). Follows WhatsappTab.vue's load-into-draft +
 * PATCH-only-what-changed pattern; the backend
 * (/api/v1/store/current/merchant-profile/) is the authority for validation
 * and RBAC, this form just mirrors it for fast feedback and hides the
 * editing UI from members without write access.
 */

const UF_OPTIONS: BrazilianUf[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const SOCIAL_FIELDS = [
  { key: 'website_url', label: 'Site', placeholder: 'https://minhaloja.com.br' },
  { key: 'instagram_url', label: 'Instagram', placeholder: 'https://instagram.com/minhaloja' },
  { key: 'facebook_url', label: 'Facebook', placeholder: 'https://facebook.com/minhaloja' },
  { key: 'tiktok_url', label: 'TikTok', placeholder: 'https://tiktok.com/@minhaloja' },
  { key: 'youtube_url', label: 'YouTube', placeholder: 'https://youtube.com/@minhaloja' },
] as const;

type EditableField = keyof MerchantProfilePayload;

const EDITABLE_FIELDS: EditableField[] = [
  'legal_name', 'trade_name', 'tax_id', 'contact_email', 'contact_phone',
  'postal_code', 'street', 'number', 'complement', 'district', 'city', 'state',
  'country', 'website_url', 'instagram_url', 'facebook_url', 'tiktok_url', 'youtube_url',
];

function emptyDraft(): Record<EditableField, string> {
  return {
    legal_name: '', trade_name: '', tax_id: '', contact_email: '', contact_phone: '',
    postal_code: '', street: '', number: '', complement: '', district: '', city: '',
    state: '', country: 'BR', website_url: '', instagram_url: '', facebook_url: '',
    tiktok_url: '', youtube_url: '',
  };
}

const { canManageCatalog } = useCurrentUser();
const { selectedStore } = useCurrentStore();
const { success, error: toastError } = useToast();

// `run()` is not used: it writes the shared refs unconditionally, so a stale
// GET/PATCH from a store the user already switched away from could still
// land on the form (real MEDIUM finding). We keep its refs but drive them
// through guarded handlers below. Same idea as
// usePublicStorefrontAppearance.ts's loadRequestId -- kept local to this
// tab, no change to the shared composable.
const {
  data: profile,
  isLoading,
  error: loadError,
} = useAsyncResource<MerchantProfile>();

const draft = reactive<Record<EditableField, string>>(emptyDraft());
const fieldErrors = reactive<Partial<Record<EditableField, string>>>({});
const formError = ref<string | null>(null);
const isSaving = ref(false);

// Monotonic tokens: every fetch / save / store-switch bumps the matching
// counter, so a response that resolves after a newer one (or after a store
// switch) is detected as stale and its effects are dropped.
let loadRequestId = 0;
let saveRequestId = 0;

function currentStoreKey(): number | string | null {
  return selectedStore.value?.id ?? selectedStore.value?.slug ?? null;
}

function isStaleResponse(
  requestId: number,
  latestId: number,
  storeKeyAtStart: number | string | null,
): boolean {
  if (requestId !== latestId) {
    return true;
  }
  // Only enforce store identity when we actually knew the store at start
  // (the very first load can begin before DashboardLayout resolves it).
  return storeKeyAtStart !== null && currentStoreKey() !== storeKeyAtStart;
}

const canEdit = computed(() => canManageCatalog.value);

function hydrateDraft(source: MerchantProfile | null): void {
  const next = emptyDraft();
  if (source) {
    for (const field of EDITABLE_FIELDS) {
      const value = source[field as keyof MerchantProfile];
      next[field] = value == null ? '' : String(value);
    }
  }
  Object.assign(draft, next);
  clearErrors();
}

function clearErrors(): void {
  formError.value = null;
  for (const key of Object.keys(fieldErrors) as EditableField[]) {
    delete fieldErrors[key];
  }
}

async function fetchProfile(): Promise<void> {
  const requestId = ++loadRequestId;
  const storeKeyAtStart = currentStoreKey();

  isLoading.value = true;
  loadError.value = null;

  let loaded: MerchantProfile | null = null;
  let failed = false;
  try {
    loaded = await storeService.getMerchantProfile();
  } catch (caught: unknown) {
    failed = true;
    Logger.warn('Merchant profile load failed', buildErrorContext(caught as ApplicationError));
  }

  // A newer fetch or a store switch happened while this request was in
  // flight: drop everything -- data, draft, error and loading are owned by
  // whatever request is current now.
  if (isStaleResponse(requestId, loadRequestId, storeKeyAtStart)) {
    return;
  }

  isLoading.value = false;
  if (failed) {
    profile.value = null;
    loadError.value = 'Não foi possível carregar o perfil da loja agora.';
    return;
  }

  profile.value = loaded;
  hydrateDraft(loaded);
}

const isDirty = computed(() => {
  if (!profile.value) {
    return EDITABLE_FIELDS.some((field) => draft[field].trim() !== (field === 'country' ? 'BR' : ''));
  }
  return EDITABLE_FIELDS.some((field) => {
    const original = profile.value?.[field as keyof MerchantProfile];
    return draft[field] !== (original == null ? '' : String(original));
  });
});

const emailLooksInvalid = computed(() => {
  const value = draft.contact_email.trim();
  return value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
});

function urlLooksInvalid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !/^https?:\/\/.+/i.test(trimmed);
}

const anySocialUrlInvalid = computed(() =>
  SOCIAL_FIELDS.some((field) => urlLooksInvalid(draft[field.key])),
);

const clientValidationMessage = computed(() => {
  if (emailLooksInvalid.value) {
    return 'Informe um e-mail válido.';
  }
  if (anySocialUrlInvalid.value) {
    return 'Os links devem começar com https://';
  }
  return '';
});

const canSave = computed(
  () =>
    canEdit.value &&
    !isSaving.value &&
    !isLoading.value &&
    isDirty.value &&
    !clientValidationMessage.value,
);

function buildChangedPayload(): MerchantProfilePayload {
  const payload: MerchantProfilePayload = {};
  for (const field of EDITABLE_FIELDS) {
    const original = profile.value?.[field as keyof MerchantProfile];
    const originalString = original == null ? '' : String(original);
    if (draft[field] !== originalString) {
      if (field === 'state') {
        payload.state = (draft.state as BrazilianUf) || '';
      } else {
        (payload[field] as string) = draft[field].trim();
      }
    }
  }
  return payload;
}

function applyServerErrors(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  let matched = false;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!EDITABLE_FIELDS.includes(key as EditableField)) {
      continue;
    }
    const message = Array.isArray(value) ? String(value[0]) : String(value);
    fieldErrors[key as EditableField] = message;
    matched = true;
  }
  return matched;
}

async function handleSubmit(): Promise<void> {
  if (!canSave.value) {
    return;
  }

  const payload = buildChangedPayload();
  if (Object.keys(payload).length === 0) {
    return;
  }

  const requestId = ++saveRequestId;
  const storeKeyAtStart = currentStoreKey();
  isSaving.value = true;
  clearErrors();

  try {
    const updated = await storeService.updateMerchantProfile(payload);
    if (isStaleResponse(requestId, saveRequestId, storeKeyAtStart)) {
      return;
    }
    profile.value = updated;
    hydrateDraft(updated);
    success('Perfil da loja atualizado.');
  } catch (caught: unknown) {
    Logger.error('Merchant profile save failed', buildErrorContext(caught as ApplicationError));
    if (isStaleResponse(requestId, saveRequestId, storeKeyAtStart)) {
      return;
    }
    const handledFieldErrors =
      isAxiosError(caught) && caught.response?.status === 400
        ? applyServerErrors(caught.response?.data)
        : false;
    formError.value = handledFieldErrors
      ? 'Revise os campos destacados e tente novamente.'
      : 'Não foi possível salvar o perfil da loja. Tente novamente.';
    toastError('Não foi possível salvar o perfil da loja.');
  } finally {
    // Only the current save clears the flag; a superseded save leaves the
    // store-switch handler's reset (below) untouched.
    if (requestId === saveRequestId) {
      isSaving.value = false;
    }
  }
}

onMounted(() => {
  void fetchProfile();
});

useStoreSwitchEffect(() => {
  // Invalidate any GET/PATCH still in flight for the previous store before
  // loading the new one, and drop a pending save's disabled state so the
  // new store's form is immediately usable.
  loadRequestId += 1;
  saveRequestId += 1;
  isSaving.value = false;
  void fetchProfile();
});
</script>

<template>
  <section class="max-w-2xl space-y-4" data-cy="merchant-profile-tab">
    <div
      v-if="isLoading"
      class="rounded-lg border border-[#E5E7EB] bg-white p-4"
      data-cy="merchant-profile-loading"
    >
      <div class="h-4 w-52 animate-pulse rounded bg-zinc-100" />
      <div class="mt-3 h-3 w-72 animate-pulse rounded bg-zinc-100" />
    </div>

    <div
      v-else-if="loadError"
      class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-4 text-sm text-[#374151]"
      data-cy="merchant-profile-load-error"
    >
      {{ loadError }}
    </div>

    <template v-else>
      <div
        class="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-zinc-50 p-3"
        data-cy="merchant-profile-status"
      >
        <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
          Status do perfil
        </p>
        <span
          class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
          :class="profile?.is_complete
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-amber-50 text-amber-700'"
        >
          {{ profile?.is_complete ? 'Completo' : 'Incompleto' }}
        </span>
      </div>

      <p
        v-if="!canEdit"
        class="rounded-lg border border-[#E5E7EB] bg-white p-3 text-xs text-bip-muted"
      >
        Você pode visualizar o perfil da loja, mas não tem permissão para editá-lo.
      </p>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Identidade -->
        <fieldset
          class="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-4"
          :disabled="!canEdit"
        >
          <legend class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Informações da loja
          </legend>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Razão social</span>
            <input
              v-model="draft.legal_name"
              type="text"
              maxlength="160"
              data-cy="merchant-legal-name"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="fieldErrors.legal_name" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.legal_name }}</span>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Nome fantasia</span>
            <input
              v-model="draft.trade_name"
              type="text"
              maxlength="160"
              data-cy="merchant-trade-name"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="fieldErrors.trade_name" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.trade_name }}</span>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">CPF ou CNPJ</span>
            <input
              v-model="draft.tax_id"
              type="text"
              inputmode="numeric"
              maxlength="20"
              data-cy="merchant-tax-id"
              placeholder="Somente números"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="fieldErrors.tax_id" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.tax_id }}</span>
          </label>
        </fieldset>

        <!-- Contato -->
        <fieldset
          class="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-4"
          :disabled="!canEdit"
        >
          <legend class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Contato
          </legend>
          <p class="text-[11px] leading-4 text-bip-muted">
            O número de WhatsApp usado no checkout fica na aba <strong>WhatsApp</strong>.
          </p>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">E-mail</span>
            <input
              v-model="draft.contact_email"
              type="email"
              autocomplete="email"
              maxlength="254"
              data-cy="merchant-contact-email"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="emailLooksInvalid" class="mt-1 block text-xs font-semibold text-amber-700">Informe um e-mail válido.</span>
            <span v-if="fieldErrors.contact_email" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.contact_email }}</span>
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Telefone</span>
            <input
              v-model="draft.contact_phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              maxlength="20"
              data-cy="merchant-contact-phone"
              placeholder="Com DDD"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="fieldErrors.contact_phone" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.contact_phone }}</span>
          </label>
        </fieldset>

        <!-- Endereço -->
        <fieldset
          class="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-4"
          :disabled="!canEdit"
        >
          <legend class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Endereço
          </legend>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">CEP</span>
              <input
                v-model="draft.postal_code"
                type="text"
                inputmode="numeric"
                maxlength="12"
                data-cy="merchant-postal-code"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              />
              <span v-if="fieldErrors.postal_code" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.postal_code }}</span>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">UF</span>
              <select
                v-model="draft.state"
                data-cy="merchant-state"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              >
                <option value="">--</option>
                <option v-for="uf in UF_OPTIONS" :key="uf" :value="uf">{{ uf }}</option>
              </select>
              <span v-if="fieldErrors.state" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors.state }}</span>
            </label>
          </div>

          <label class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Rua</span>
            <input
              v-model="draft.street"
              type="text"
              maxlength="160"
              data-cy="merchant-street"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
          </label>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Número</span>
              <input
                v-model="draft.number"
                type="text"
                maxlength="20"
                data-cy="merchant-number"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              />
            </label>
            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Complemento</span>
              <input
                v-model="draft.complement"
                type="text"
                maxlength="80"
                data-cy="merchant-complement"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              />
            </label>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Bairro</span>
              <input
                v-model="draft.district"
                type="text"
                maxlength="80"
                data-cy="merchant-district"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              />
            </label>
            <label class="block">
              <span class="mb-1.5 block text-xs font-bold text-[#05050A]">Cidade</span>
              <input
                v-model="draft.city"
                type="text"
                maxlength="80"
                data-cy="merchant-city"
                class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              />
            </label>
          </div>
        </fieldset>

        <!-- Redes sociais -->
        <fieldset
          class="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-4"
          :disabled="!canEdit"
        >
          <legend class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Links e redes sociais
          </legend>

          <label v-for="field in SOCIAL_FIELDS" :key="field.key" class="block">
            <span class="mb-1.5 block text-xs font-bold text-[#05050A]">{{ field.label }}</span>
            <input
              v-model="draft[field.key]"
              type="url"
              inputmode="url"
              maxlength="300"
              :data-cy="`merchant-${field.key.replace('_url', '')}`"
              :placeholder="field.placeholder"
              class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            />
            <span v-if="urlLooksInvalid(draft[field.key])" class="mt-1 block text-xs font-semibold text-amber-700">Comece com https://</span>
            <span v-if="fieldErrors[field.key]" class="mt-1 block text-xs font-semibold text-[#b91c1c]">{{ fieldErrors[field.key] }}</span>
          </label>
        </fieldset>

        <p
          v-if="clientValidationMessage"
          class="text-xs font-semibold text-amber-700"
          data-cy="merchant-profile-client-error"
        >
          {{ clientValidationMessage }}
        </p>
        <p
          v-if="formError"
          class="text-xs font-semibold text-[#b91c1c]"
          data-cy="merchant-profile-form-error"
        >
          {{ formError }}
        </p>

        <button
          v-if="canEdit"
          type="submit"
          data-cy="btn-save-merchant-profile"
          :disabled="!canSave"
          class="w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted"
        >
          {{ isSaving ? 'Salvando...' : 'Salvar alterações' }}
        </button>
      </form>
    </template>
  </section>
</template>
