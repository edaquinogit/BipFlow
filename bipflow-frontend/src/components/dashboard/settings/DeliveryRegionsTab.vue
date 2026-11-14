<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PencilSquareIcon, TrashIcon } from '@heroicons/vue/24/outline';
import { useAsyncResource } from '@/composables/useAsyncResource';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import { useCurrentUser } from '@/composables/useCurrentUser';
import { useToast } from '@/composables/useToast';
import type { DeliveryRegion, DeliveryRegionPayload } from '@/types/delivery';
import { deliveryRegionService } from '@/services/delivery-region.service';
import { Logger } from '@/services/logger';
import { buildErrorContext, type ApplicationError } from '@/types/errors';
import { formatBRL } from '@/utils/formatters';
import ShippingLogisticsSettingsPanel from '@/components/dashboard/settings/ShippingLogisticsSettingsPanel.vue';

const { canManageCatalog } = useCurrentUser();
const { success, error: toastError } = useToast();

const {
  data: deliveryRegionsData,
  isLoading: isDeliveryRegionsLoading,
  error: deliveryRegionsError,
  run: runFetchDeliveryRegions,
} = useAsyncResource<DeliveryRegion[]>();
const deliveryRegions = computed(() => deliveryRegionsData.value ?? []);

const isSavingDeliveryRegion = ref(false);
const deletingDeliveryRegionId = ref<number | null>(null);
const editingRegionId = ref<number | null>(null);
const regionDraft = ref<DeliveryRegionPayload>({
  name: '',
  city: '',
  neighborhoods: '',
  delivery_fee: '',
  is_active: true,
});

function resetRegionDraft(): void {
  editingRegionId.value = null;
  regionDraft.value = { name: '', city: '', neighborhoods: '', delivery_fee: '', is_active: true };
}

function fetchDeliveryRegions(): Promise<void> {
  return runFetchDeliveryRegions(
    () => deliveryRegionService.getAll(),
    'Não foi possível carregar as regiões de frete agora.'
  );
}

function editDeliveryRegion(region: DeliveryRegion): void {
  editingRegionId.value = region.id;
  regionDraft.value = {
    name: region.name,
    city: region.city,
    neighborhoods: region.neighborhoods,
    delivery_fee: String(region.delivery_fee),
    is_active: region.is_active,
  };
}

async function submitDeliveryRegion(): Promise<void> {
  const deliveryFee = Number(regionDraft.value.delivery_fee);
  if (!regionDraft.value.name.trim() || !Number.isFinite(deliveryFee) || deliveryFee < 0) {
    return;
  }

  isSavingDeliveryRegion.value = true;
  const payload: DeliveryRegionPayload = {
    name: regionDraft.value.name.trim(),
    city: regionDraft.value.city.trim(),
    neighborhoods: regionDraft.value.neighborhoods.trim(),
    delivery_fee: deliveryFee.toFixed(2),
    is_active: regionDraft.value.is_active,
  };

  try {
    if (editingRegionId.value) {
      await deliveryRegionService.update(editingRegionId.value, payload);
      success('Frete da região atualizado.');
    } else {
      await deliveryRegionService.create(payload);
      success('Região de frete adicionada.');
    }

    resetRegionDraft();
    await fetchDeliveryRegions();
  } catch (error: unknown) {
    Logger.error('Delivery region save failed', buildErrorContext(error as ApplicationError, { regionId: editingRegionId.value }));
    toastError('Não foi possível salvar a região de frete.');
  } finally {
    isSavingDeliveryRegion.value = false;
  }
}

async function handleDeleteDeliveryRegion(regionId: number): Promise<void> {
  deletingDeliveryRegionId.value = regionId;
  try {
    await deliveryRegionService.delete(regionId);
    success('Região de frete removida.');
    await fetchDeliveryRegions();
  } catch (error: unknown) {
    Logger.error('Delivery region deletion failed', buildErrorContext(error as ApplicationError, { regionId }));
    toastError('Não foi possível remover a região de frete.');
  } finally {
    deletingDeliveryRegionId.value = null;
  }
}

onMounted(() => {
  void fetchDeliveryRegions();
});

useStoreSwitchEffect(() => {
  void fetchDeliveryRegions();
});
</script>

<template>
  <div class="space-y-6">
    <ShippingLogisticsSettingsPanel />
    <section class="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
    <form v-if="canManageCatalog" class="space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-4" @submit.prevent="submitDeliveryRegion">
      <label class="block">
        <span class="mb-2 block text-[10px] font-black uppercase tracking-widest text-bip-muted">Região</span>
        <input
          v-model="regionDraft.name"
          type="text"
          class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition placeholder:text-bip-muted/70 focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
          placeholder="Centro, Zona Norte..."
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label class="block">
          <span class="mb-2 block text-[10px] font-black uppercase tracking-widest text-bip-muted">Cidade</span>
          <input
            v-model="regionDraft.city"
            type="text"
            class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition placeholder:text-bip-muted/70 focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            placeholder="Salvador"
          />
        </label>

        <label class="block">
          <span class="mb-2 block text-[10px] font-black uppercase tracking-widest text-bip-muted">Valor</span>
          <input
            v-model="regionDraft.delivery_fee"
            type="number"
            min="0"
            step="0.01"
            class="w-full rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition placeholder:text-bip-muted/70 focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
            placeholder="12.00"
          />
        </label>
      </div>

      <label class="block">
        <span class="mb-2 block text-[10px] font-black uppercase tracking-widest text-bip-muted">Bairros atendidos</span>
        <textarea
          v-model="regionDraft.neighborhoods"
          rows="3"
          class="w-full resize-none rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#05050A] outline-none transition placeholder:text-bip-muted/70 focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]"
          placeholder="Opcional: Centro, Barra, Ondina"
        />
      </label>

      <label class="flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
        <span class="text-xs font-bold text-bip-muted">Região ativa na vitrine</span>
        <input v-model="regionDraft.is_active" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] bg-white text-[#111827] focus:ring-[#F3F4F6]" />
      </label>

      <button
        type="submit"
        :disabled="isSavingDeliveryRegion"
        class="w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted"
      >
        {{ isSavingDeliveryRegion ? 'Salvando...' : editingRegionId ? 'Salvar região' : 'Adicionar região' }}
      </button>
    </form>

    <div class="space-y-3">
      <div v-if="isDeliveryRegionsLoading" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <div class="h-4 w-40 animate-pulse rounded bg-zinc-100" />
        <div class="mt-3 h-3 w-56 animate-pulse rounded bg-zinc-100" />
      </div>

      <div v-else-if="deliveryRegionsError" class="rounded-lg border border-[#111827]/20 bg-[#F3F4F6] p-4 text-sm text-[#374151]">
        {{ deliveryRegionsError }}
      </div>

      <div v-else-if="deliveryRegions.length === 0" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <p class="text-sm font-semibold text-[#05050A]">Nenhuma região cadastrada.</p>
        <p class="mt-1 text-xs leading-5 text-bip-muted">Cadastre regiões para precificar o frete no carrinho público.</p>
      </div>

      <article v-for="region in deliveryRegions" :key="region.id" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <p class="truncate text-sm font-bold text-[#05050A]">{{ region.name }}</p>
            <p class="mt-1 text-xs text-bip-muted">
              {{ region.city || 'Cidade não informada' }} - {{ region.is_active ? 'Ativa' : 'Inativa' }}
            </p>
          </div>
          <p class="shrink-0 text-sm font-black text-[#111827]">{{ formatBRL(region.delivery_fee) }}</p>
        </div>

        <p v-if="region.neighborhoods" class="mt-3 line-clamp-2 text-xs leading-5 text-bip-muted">{{ region.neighborhoods }}</p>

        <div v-if="canManageCatalog" class="mt-4 flex gap-2">
          <button
            type="button"
            class="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-bip-muted transition hover:border-[#111827]/40 hover:text-[#05050A]"
            @click="editDeliveryRegion(region)"
          >
            <PencilSquareIcon class="h-4 w-4" />
            Editar
          </button>
          <button
            type="button"
            class="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#111827]/20 bg-[#F3F4F6] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#111827] transition hover:border-[#111827]/40 hover:bg-[#F3F4F6]/70 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="deletingDeliveryRegionId === region.id"
            @click="handleDeleteDeliveryRegion(region.id)"
          >
            <TrashIcon class="h-4 w-4" />
            {{ deletingDeliveryRegionId === region.id ? 'Removendo' : 'Remover' }}
          </button>
        </div>
      </article>
    </div>
    </section>
  </div>
</template>
