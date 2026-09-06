<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import {
  BuildingStorefrontIcon,
  IdentificationIcon,
  PaintBrushIcon,
  PhoneIcon,
  PrinterIcon,
  ShieldCheckIcon,
  TagIcon,
  TruckIcon,
} from '@heroicons/vue/24/outline';
import CategoriesTab from '@/components/dashboard/settings/CategoriesTab.vue';
import DeliveryRegionsTab from '@/components/dashboard/settings/DeliveryRegionsTab.vue';
import MerchantProfileTab from '@/components/dashboard/settings/MerchantProfileTab.vue';
import ReceiptSettingsTab from '@/components/dashboard/settings/ReceiptSettingsTab.vue';
import SecurityTab from '@/components/dashboard/settings/SecurityTab.vue';
import StorefrontAppearanceTab from '@/components/dashboard/settings/StorefrontAppearanceTab.vue';
import StoresTab from '@/components/dashboard/settings/StoresTab.vue';
import WhatsappTab from '@/components/dashboard/settings/WhatsappTab.vue';

type SettingsTab =
  | 'perfil'
  | 'categorias'
  | 'frete'
  | 'whatsapp'
  | 'lojas'
  | 'recibo'
  | 'seguranca'
  | 'aparencia';

const TABS: { value: SettingsTab; label: string; icon: typeof TagIcon; component: Component }[] = [
  { value: 'perfil', label: 'Perfil da loja', icon: IdentificationIcon, component: MerchantProfileTab },
  { value: 'categorias', label: 'Categorias', icon: TagIcon, component: CategoriesTab },
  { value: 'aparencia', label: 'Aparencia da vitrine', icon: PaintBrushIcon, component: StorefrontAppearanceTab },
  { value: 'frete', label: 'Frete', icon: TruckIcon, component: DeliveryRegionsTab },
  { value: 'whatsapp', label: 'WhatsApp', icon: PhoneIcon, component: WhatsappTab },
  { value: 'lojas', label: 'Lojas', icon: BuildingStorefrontIcon, component: StoresTab },
  { value: 'recibo', label: 'Recibo', icon: PrinterIcon, component: ReceiptSettingsTab },
  { value: 'seguranca', label: 'Seguranca', icon: ShieldCheckIcon, component: SecurityTab },
];

const activeTab = ref<SettingsTab>('perfil');
const activeTabComponent = computed(() => (
  TABS.find((tab) => tab.value === activeTab.value)?.component
));
</script>

<template>
  <div>
    <div>
      <p class="text-[10px] font-black uppercase tracking-[0.4em] text-bip-muted">Operação</p>
      <h1 class="mt-1 text-xl font-black italic tracking-tighter text-[#05050A]">Configurações</h1>
    </div>

    <nav role="tablist" aria-label="Secoes de configuracao" class="mt-6 inline-flex flex-wrap items-center gap-1 rounded-full border border-[#E5E7EB] bg-zinc-100 p-1">
      <button
        v-for="tab in TABS"
        :key="tab.value"
        type="button"
        :data-cy="`settings-tab-${tab.value}`"
        role="tab"
        :aria-selected="activeTab === tab.value"
        class="flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-all duration-300"
        :class="activeTab === tab.value ? 'bg-[#111827] text-white shadow-lg shadow-[#111827]/30' : 'text-bip-muted hover:text-[#05050A]'"
        @click="activeTab = tab.value"
      >
        <component :is="tab.icon" class="h-4 w-4" />
        {{ tab.label }}
      </button>
    </nav>

    <component :is="activeTabComponent" class="mt-8" />
  </div>
</template>
