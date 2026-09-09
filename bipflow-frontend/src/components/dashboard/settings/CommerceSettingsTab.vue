<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useAsyncResource } from '@/composables/useAsyncResource';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import { useCurrentStore } from '@/composables/useCurrentStore';
import { useCurrentUser } from '@/composables/useCurrentUser';
import { useToast } from '@/composables/useToast';
import { Logger } from '@/services/logger';
import { buildErrorContext, isAxiosError, type ApplicationError } from '@/types/errors';
import { commerceSettingsService } from '@/services/commerceSettings.service';
import {
  commerceSettingsInvariantErrors,
  type CommerceSettings,
} from '@/schemas/commerceSettings.schema';

const { canManageCatalog } = useCurrentUser();
const { selectedStore } = useCurrentStore();
const { success, error: toastError } = useToast();

// `run()` is deliberately not used (same reasoning as MerchantProfileTab):
// it writes the shared refs unconditionally, so a GET that resolves after
// the user already switched stores could land this store's config on the
// form. We keep useAsyncResource's refs but drive them through the guarded
// handlers below.
const {
  data: settings,
  isLoading,
  error: loadError,
} = useAsyncResource<CommerceSettings>();

// Monotonic tokens: every fetch / save / store-switch bumps the counter, so
// a response that resolves after a newer one (or after a store switch) is
// detected as stale and its effects dropped.
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
  return storeKeyAtStart !== null && currentStoreKey() !== storeKeyAtStart;
}

const isSaving = ref(false);
const backendError = ref('');

interface CommerceDraft {
  orders_enabled: boolean;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  minimum_order_value: string;
  accepts_pix: boolean;
  accepts_card: boolean;
  accepts_cash: boolean;
}

const draft = reactive<CommerceDraft>({
  orders_enabled: true,
  delivery_enabled: true,
  pickup_enabled: true,
  minimum_order_value: '0.00',
  accepts_pix: true,
  accepts_card: true,
  accepts_cash: true,
});

function syncDraftFromSettings(source: CommerceSettings): void {
  draft.orders_enabled = source.orders_enabled;
  draft.delivery_enabled = source.delivery_enabled;
  draft.pickup_enabled = source.pickup_enabled;
  draft.minimum_order_value = source.minimum_order_value;
  draft.accepts_pix = source.accepts_pix;
  draft.accepts_card = source.accepts_card;
  draft.accepts_cash = source.accepts_cash;
}

const invariantErrors = computed(() => commerceSettingsInvariantErrors(draft));
const hasInvariantError = computed(() => Object.keys(invariantErrors.value).length > 0);

const canSave = computed(
  () => canManageCatalog.value && !isSaving.value && !isLoading.value && !hasInvariantError.value,
);

async function fetchSettings(): Promise<void> {
  const requestId = ++loadRequestId;
  const storeKeyAtStart = currentStoreKey();

  backendError.value = '';
  isLoading.value = true;
  loadError.value = null;

  let loaded: CommerceSettings | null = null;
  let failed = false;
  try {
    loaded = await commerceSettingsService.get();
  } catch (caught: unknown) {
    failed = true;
    Logger.warn('Commerce settings load failed', buildErrorContext(caught as ApplicationError));
  }

  if (isStaleResponse(requestId, loadRequestId, storeKeyAtStart)) {
    return;
  }

  isLoading.value = false;
  if (failed || !loaded) {
    settings.value = null;
    loadError.value = 'Não foi possível carregar as configurações de vendas agora.';
    return;
  }

  settings.value = loaded;
  syncDraftFromSettings(loaded);
}

async function submit(): Promise<void> {
  if (!canSave.value) {
    return;
  }

  const requestId = ++saveRequestId;
  const storeKeyAtStart = currentStoreKey();

  isSaving.value = true;
  backendError.value = '';
  try {
    const updated = await commerceSettingsService.update({
      orders_enabled: draft.orders_enabled,
      delivery_enabled: draft.delivery_enabled,
      pickup_enabled: draft.pickup_enabled,
      minimum_order_value: Number(draft.minimum_order_value).toFixed(2),
      accepts_pix: draft.accepts_pix,
      accepts_card: draft.accepts_card,
      accepts_cash: draft.accepts_cash,
    });

    if (isStaleResponse(requestId, saveRequestId, storeKeyAtStart)) {
      return;
    }

    settings.value = updated;
    syncDraftFromSettings(updated);
    success('Configurações de vendas atualizadas.');
  } catch (error: unknown) {
    if (isStaleResponse(requestId, saveRequestId, storeKeyAtStart)) {
      return;
    }
    Logger.warn('Commerce settings save failed', buildErrorContext(error as ApplicationError));
    if (isAxiosError(error) && error.response?.status === 400) {
      const data = error.response.data as Record<string, unknown>;
      const firstMessage = Object.values(data).flat().find((value) => typeof value === 'string');
      backendError.value =
        (firstMessage as string) ?? 'Revise os campos: combinação inválida.';
    } else {
      backendError.value = 'Não foi possível salvar as configurações de vendas.';
    }
    toastError(backendError.value);
  } finally {
    if (requestId === saveRequestId) {
      isSaving.value = false;
    }
  }
}

onMounted(() => {
  void fetchSettings();
});

useStoreSwitchEffect(() => {
  void fetchSettings();
});

const paymentMethods: { key: 'accepts_pix' | 'accepts_card' | 'accepts_cash'; label: string }[] = [
  { key: 'accepts_pix', label: 'Pix' },
  { key: 'accepts_card', label: 'Cartão' },
  { key: 'accepts_cash', label: 'Dinheiro' },
];
</script>

<template>
  <section class="max-w-lg" data-cy="commerce-settings">
    <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Vendas online</p>
    <h2 class="mt-1 text-lg font-black italic tracking-tighter text-[#05050A]">
      Como sua loja recebe pedidos
    </h2>

    <div v-if="isLoading" class="mt-4 space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-4">
      <div class="h-4 w-48 animate-pulse rounded bg-zinc-100" />
      <div class="h-4 w-64 animate-pulse rounded bg-zinc-100" />
      <div class="h-4 w-40 animate-pulse rounded bg-zinc-100" />
    </div>

    <div
      v-else-if="loadError"
      class="mt-4 rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-4 text-sm text-[#374151]"
      data-cy="commerce-settings-load-error"
    >
      {{ loadError }}
    </div>

    <form
      v-else
      class="mt-4 space-y-6 rounded-lg border border-[#E5E7EB] bg-white p-4"
      @submit.prevent="submit"
    >
      <fieldset :disabled="!canManageCatalog" class="space-y-6 disabled:opacity-70">
        <!-- Accepting orders -->
        <label class="flex items-start justify-between gap-4">
          <span>
            <span class="block text-sm font-bold text-[#05050A]">Aceitar novos pedidos</span>
            <span class="mt-0.5 block text-xs text-bip-muted">
              Desative para pausar o recebimento sem tirar a vitrine do ar.
            </span>
          </span>
          <input
            v-model="draft.orders_enabled"
            type="checkbox"
            role="switch"
            data-cy="commerce-orders-enabled"
            class="commerce-toggle"
          />
        </label>

        <div class="border-t border-[#F3F4F6] pt-5">
          <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Formas de entrega
          </p>
          <div class="mt-3 space-y-3">
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm font-semibold text-[#05050A]">Entrega (delivery)</span>
              <input
                v-model="draft.delivery_enabled"
                type="checkbox"
                role="switch"
                data-cy="commerce-delivery-enabled"
                class="commerce-toggle"
              />
            </label>
            <label class="flex items-center justify-between gap-4">
              <span class="text-sm font-semibold text-[#05050A]">Retirada na loja</span>
              <input
                v-model="draft.pickup_enabled"
                type="checkbox"
                role="switch"
                data-cy="commerce-pickup-enabled"
                class="commerce-toggle"
              />
            </label>
          </div>
          <p
            v-if="invariantErrors.delivery_enabled"
            class="mt-2 text-xs font-semibold text-[#B45309]"
            data-cy="commerce-delivery-error"
          >
            {{ invariantErrors.delivery_enabled }}
          </p>
        </div>

        <div class="border-t border-[#F3F4F6] pt-5">
          <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
            Formas de pagamento aceitas
          </p>
          <div class="mt-3 space-y-3">
            <label
              v-for="method in paymentMethods"
              :key="method.key"
              class="flex items-center justify-between gap-4"
            >
              <span class="text-sm font-semibold text-[#05050A]">{{ method.label }}</span>
              <input
                v-model="draft[method.key]"
                type="checkbox"
                role="switch"
                :data-cy="`commerce-${method.key.replace('_', '-')}`"
                class="commerce-toggle"
              />
            </label>
          </div>
          <p
            v-if="invariantErrors.accepts_pix"
            class="mt-2 text-xs font-semibold text-[#B45309]"
            data-cy="commerce-payment-error"
          >
            {{ invariantErrors.accepts_pix }}
          </p>
        </div>

        <div class="border-t border-[#F3F4F6] pt-5">
          <label class="block">
            <span class="text-[10px] font-black uppercase tracking-widest text-bip-muted">
              Pedido mínimo (R$)
            </span>
            <span class="mt-0.5 block text-xs text-bip-muted">
              Valor dos produtos antes do frete. Use 0 para não exigir mínimo.
            </span>
            <input
              v-model="draft.minimum_order_value"
              type="number"
              inputmode="decimal"
              min="0"
              step="0.01"
              data-cy="commerce-minimum-order-value"
              class="mt-2 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
              :class="{ 'border-[#B45309]': invariantErrors.minimum_order_value }"
            />
            <span
              v-if="invariantErrors.minimum_order_value"
              class="mt-1 block text-xs font-semibold text-[#B45309]"
              data-cy="commerce-minimum-error"
            >
              {{ invariantErrors.minimum_order_value }}
            </span>
          </label>
        </div>
      </fieldset>

      <p
        v-if="backendError"
        class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-3 text-xs font-semibold text-[#374151]"
        data-cy="commerce-settings-backend-error"
        role="alert"
      >
        {{ backendError }}
      </p>

      <button
        v-if="canManageCatalog"
        type="submit"
        :disabled="!canSave"
        data-cy="commerce-settings-save"
        class="w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted"
      >
        {{ isSaving ? 'Salvando...' : 'Salvar configurações de vendas' }}
      </button>
      <p v-else class="text-xs text-bip-muted">
        Você pode visualizar, mas não editar as configurações de vendas.
      </p>
    </form>
  </section>
</template>

<style scoped>
/* 44px hit area with a compact switch visual -- keyboard focus ring included. */
.commerce-toggle {
  position: relative;
  flex: none;
  appearance: none;
  width: 3rem;
  height: 1.75rem;
  border-radius: 9999px;
  background: #d1d5db;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.commerce-toggle::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 9999px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  transition: transform 0.15s ease;
}

.commerce-toggle:checked {
  background: #111827;
}

.commerce-toggle:checked::after {
  transform: translateX(1.25rem);
}

.commerce-toggle:focus-visible {
  outline: 2px solid #111827;
  outline-offset: 2px;
}

.commerce-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
