<script setup lang="ts">
import { useRouter } from 'vue-router';
import StatCard from './StatCard.vue';
import StatSkeleton from './StatSkeleton.vue';
import RevenueCard from './RevenueCard.vue';
import {
  ShoppingBagIcon,
  ExclamationTriangleIcon
} from '@heroicons/vue/24/outline';
import { DashboardRoutes } from '@/router/dashboard.routes';

// Contrato de Interface (BipFlow Standard)
interface InventoryStats {
  totalItems: number;
  lowStockCount: number;
}

defineProps<{
  stats: InventoryStats | null;
  revenue: string | number;
  revenueComparison?: number | null;
  // Online-sales foundation: confirmed-money vs pending split, so the volume
  // number above it is never read as "revenue received".
  revenueSubtitle?: string | null;
  isLoading: boolean;
}>();

const emit = defineEmits<{ openStockAlerts: [] }>();

const router = useRouter();

const goToProducts = (): void => {
  router.push({ name: DashboardRoutes.Products });
};
</script>

<template>
  <section class="grid grid-cols-1 md:grid-cols-3 gap-8">

    <template v-if="isLoading">
      <StatSkeleton v-for="i in 3" :key="i" />
    </template>

    <template v-else>
      <StatCard
        label="Itens em estoque"
        :value="stats?.totalItems ?? 0"
        :icon="(ShoppingBagIcon as any)"
        color="rose"
        clickable
        @click="goToProducts"
      />

      <StatCard
        label="Alertas criticos"
        :value="stats?.lowStockCount ?? 0"
        :icon="(ExclamationTriangleIcon as any)"
        color="orange"
        clickable
        @click="emit('openStockAlerts')"
      />

      <RevenueCard
        :value="revenue"
        :comparison="revenueComparison ?? null"
        :subtitle="revenueSubtitle ?? null"
      />
    </template>

  </section>
</template>
