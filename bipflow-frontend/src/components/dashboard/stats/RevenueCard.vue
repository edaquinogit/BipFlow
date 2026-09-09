<script setup lang="ts">
import { computed } from 'vue';
import { BanknotesIcon } from '@heroicons/vue/24/outline';

const props = defineProps<{
  value: string | number;
  comparison?: number | null;
  // Online-sales foundation: the confirmed-vs-pending money split. The big
  // number is order volume (non-cancelled orders, any payment state); this
  // subtitle stops it being read as "revenue received".
  subtitle?: string | null;
}>();

const hasComparison = computed(() => props.comparison !== null && props.comparison !== undefined);
const isPositiveComparison = computed(() => (props.comparison ?? 0) >= 0);
const accessibleLabel = computed(() => {
  const base = `Vendas dos ultimos 30 dias: ${props.value}`;
  const withSubtitle = props.subtitle ? `${base}. ${props.subtitle}` : base;

  if (!hasComparison.value) {
    return withSubtitle;
  }

  const trend = isPositiveComparison.value ? 'aumento' : 'queda';
  return `${withSubtitle}, ${trend} de ${Math.abs(props.comparison ?? 0).toFixed(1)}% vs periodo anterior`;
});
</script>

<template>
  <div role="group" :aria-label="accessibleLabel" class="revenue-card-root">
    <div class="relative z-10">
      <p class="text-[10px] font-black text-rose-100 uppercase tracking-[0.3em] mb-1 opacity-80">
        Vendas (30 dias)
      </p>
      <h3 class="text-4xl font-black text-white italic tracking-tighter transition-all duration-700">
        {{ value }}
      </h3>
      <p v-if="subtitle" class="mt-2 text-xs font-semibold text-rose-100/90" data-cy="revenue-card-subtitle">
        {{ subtitle }}
      </p>
      <p
        v-if="hasComparison"
        class="mt-2 text-xs font-bold"
        :class="isPositiveComparison ? 'text-emerald-300' : 'text-rose-300'"
      >
        {{ isPositiveComparison ? '▲' : '▼' }} {{ Math.abs(comparison ?? 0).toFixed(1) }}% vs periodo anterior
      </p>
    </div>

    <BanknotesIcon
      class="revenue-icon"
      aria-hidden="true"
    />

    <div class="glass-overlay"></div>
  </div>
</template>

<style scoped>
/* * BipFlow Executive Style Suite
 * Estilização isolada para evitar conflitos com o parser do Tailwind/Vite.
 */
.revenue-card-root {
  position: relative;
  overflow: hidden;
  padding: 2rem;
  border-radius: 2.5rem;
  background: linear-gradient(135deg, #05050a 0%, #5f1235 48%, #111827 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 20px 45px -20px rgba(5, 5, 10, 0.35), 0 25px 50px -12px rgba(17, 24, 39, 0.32);
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: default;
}

.revenue-card-root:hover {
  transform: scale(1.02);
  border-color: rgba(255, 255, 255, 0.2);
}

.revenue-icon {
  position: absolute;
  right: -1.5rem;
  bottom: -1.5rem;
  width: 9rem; /* w-36 */
  height: 9rem;
  color: white;
  opacity: 0.1;
  transition: all 1s ease;
}

.revenue-card-root:hover .revenue-icon {
  transform: scale(1.1) rotate(-12deg);
  opacity: 0.15;
}

.glass-overlay {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.7s ease;
  background: linear-gradient(to top right, rgba(255, 255, 255, 0.1), transparent);
}

.revenue-card-root:hover .glass-overlay {
  opacity: 1;
}
</style>
