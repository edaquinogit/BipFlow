<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useToast } from '@/composables/useToast';
import { useStoreSwitchEffect } from '@/composables/useStoreSwitchEffect';
import { shippingSettingsService } from '@/services/shipping-settings.service';
import type { ShippingPackageOption, StoreShippingSettings } from '@/types/shipping';

const { success, error: toastError } = useToast();
const isLoading = ref(false);
const isSaving = ref(false);
const settings = ref<StoreShippingSettings>({
  national_shipping_enabled: false,
  origin_postal_code: '',
  packaging_weight_grams: 0,
  package_options: [],
});
const originCep = computed({
  get: () => settings.value.origin_postal_code,
  set: (value: string) => {
    settings.value.origin_postal_code = value.replace(/\\D/g, '').slice(0, 8);
  },
});

async function loadSettings(): Promise<void> {
  isLoading.value = true;
  try {
    settings.value = await shippingSettingsService.get();
  } catch {
    toastError('Não foi possível carregar a configuração logística.');
  } finally {
    isLoading.value = false;
  }
}

function addPackage(): void {
  if (settings.value.package_options.length >= 20) return;
  settings.value.package_options.push({
    name: '',
    length_cm: 0,
    width_cm: 0,
    height_cm: 0,
    tare_weight_grams: 0,
  });
}

function removePackage(index: number): void {
  settings.value.package_options.splice(index, 1);
}

function isValidPackage(option: ShippingPackageOption): boolean {
  return Boolean(option.name.trim())
    && option.length_cm > 0
    && option.width_cm > 0
    && option.height_cm > 0
    && option.tare_weight_grams >= 0;
}

async function saveSettings(): Promise<void> {
  const cep = settings.value.origin_postal_code.replace(/\\D/g, '');
  if (cep && cep.length !== 8) {
    toastError('Informe um CEP de origem com 8 dígitos.');
    return;
  }
  if (settings.value.package_options.some((option) => !isValidPackage(option))) {
    toastError('Revise as embalagens: nome e dimensões são obrigatórios.');
    return;
  }

  isSaving.value = true;
  try {
    settings.value = await shippingSettingsService.update({
      origin_postal_code: cep,
      packaging_weight_grams: settings.value.packaging_weight_grams,
      package_options: settings.value.package_options,
    });
    success('Configuração logística salva.');
  } catch {
    toastError('Não foi possível salvar a configuração logística.');
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => void loadSettings());
useStoreSwitchEffect(() => void loadSettings());
</script>

<template>
  <section class="rounded-xl border border-[#E5E7EB] bg-white p-4 sm:p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-black text-[#05050A]">Dados logísticos da loja</h2>
        <p class="mt-1 max-w-2xl text-xs leading-5 text-bip-muted">
          Cadastre a origem e os tipos de embalagem para preparar futuras cotações nacionais.
          Isso não altera o frete local nem ativa cotações nesta etapa.
        </p>
      </div>
      <span class="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
        Cotação nacional desativada
      </span>
    </div>

    <div v-if="isLoading" class="mt-4 text-xs text-bip-muted">Carregando configuração...</div>

    <form v-else class="mt-5 space-y-5" @submit.prevent="saveSettings">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-bip-muted">CEP de origem</span>
          <input
            v-model="originCep"
            inputmode="numeric"
            autocomplete="postal-code"
            maxlength="8"
            placeholder="00000000"
            class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]"
          />
          <span class="mt-1 block text-[10px] text-bip-muted">Somente números, sem hífen.</span>
        </label>
        <label class="block">
          <span class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-bip-muted">Peso adicional padrão da embalagem (g)</span>
          <input
            v-model.number="settings.packaging_weight_grams"
            type="number"
            min="0"
            step="1"
            class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]"
          />
        </label>
      </div>

      <div class="border-t border-[#E5E7EB] pt-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-xs font-black uppercase tracking-widest text-[#111827]">Embalagens disponíveis</h3>
            <p class="mt-1 text-[10px] text-bip-muted">Informe as medidas externas em centímetros e a tara em gramas.</p>
          </div>
          <button
            type="button"
            :disabled="settings.package_options.length >= 20"
            class="rounded-lg border border-[#D1D5DB] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#111827] disabled:opacity-40"
            @click="addPackage"
          >
            Adicionar embalagem
          </button>
        </div>

        <p v-if="settings.package_options.length === 0" class="mt-3 rounded-lg bg-zinc-50 p-3 text-xs text-bip-muted">
          Nenhuma embalagem cadastrada. Você poderá adicionar caixas e envelopes usados pela loja.
        </p>

        <div v-for="(option, index) in settings.package_options" :key="index" class="mt-3 rounded-lg border border-[#E5E7EB] p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs font-bold text-[#05050A]">Embalagem {{ index + 1 }}</span>
            <button type="button" class="text-[10px] font-bold text-red-600" @click="removePackage(index)">Remover</button>
          </div>
          <label class="mt-3 block">
            <span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-bip-muted">Nome</span>
            <input v-model="option.name" maxlength="80" placeholder="Caixa pequena" class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm outline-none focus:border-[#111827]" />
          </label>
          <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label class="block">
              <span class="mb-1 block text-[10px] font-bold text-bip-muted">Comprimento (cm)</span>
              <input v-model.number="option.length_cm" type="number" min="0.01" step="0.01" class="w-full rounded-lg border border-[#D1D5DB] px-2 py-2 text-sm" />
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] font-bold text-bip-muted">Largura (cm)</span>
              <input v-model.number="option.width_cm" type="number" min="0.01" step="0.01" class="w-full rounded-lg border border-[#D1D5DB] px-2 py-2 text-sm" />
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] font-bold text-bip-muted">Altura (cm)</span>
              <input v-model.number="option.height_cm" type="number" min="0.01" step="0.01" class="w-full rounded-lg border border-[#D1D5DB] px-2 py-2 text-sm" />
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] font-bold text-bip-muted">Tara (g)</span>
              <input v-model.number="option.tare_weight_grams" type="number" min="0" step="1" class="w-full rounded-lg border border-[#D1D5DB] px-2 py-2 text-sm" />
            </label>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] pt-4">
        <p class="max-w-xl text-[10px] leading-4 text-bip-muted">
          Os dados serão usados nas próximas etapas. A cotação automática e a integração com os Correios ainda não estão disponíveis.
        </p>
        <button type="submit" :disabled="isSaving" class="rounded-lg bg-[#111827] px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50">
          {{ isSaving ? 'Salvando...' : 'Salvar dados logísticos' }}
        </button>
      </div>
    </form>
  </section>
</template>
