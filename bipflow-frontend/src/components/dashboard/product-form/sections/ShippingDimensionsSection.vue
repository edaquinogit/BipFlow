<script setup lang="ts">
const normalizeOptionalNumber = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const weightGrams = defineModel<number | null>('weightGrams', {
  default: null,
  set: normalizeOptionalNumber,
});
const lengthCm = defineModel<number | null>('lengthCm', {
  default: null,
  set: normalizeOptionalNumber,
});
const widthCm = defineModel<number | null>('widthCm', {
  default: null,
  set: normalizeOptionalNumber,
});
const heightCm = defineModel<number | null>('heightCm', {
  default: null,
  set: normalizeOptionalNumber,
});

defineProps<{ errors: Record<string, string[]> }>();
</script>

<template>
  <section class="space-y-4 border-b border-[#E5E7EB] pb-10">
    <header>
      <h3 class="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-[#111827]">
        Dados para envio
      </h3>
      <p class="text-xs leading-5 text-bip-muted">
        Campos opcionais nesta etapa. Informe o peso e as dimensões de cada unidade para preparar o cálculo de frete nacional.
      </p>
    </header>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <label class="block">
        <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-bip-muted">Peso (g)</span>
        <input v-model.number="weightGrams" type="number" min="1" step="1" placeholder="Ex.: 500" class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]" />
        <span v-if="errors.weight_grams" class="mt-1 block text-[10px] text-red-600">{{ errors.weight_grams[0] }}</span>
      </label>
      <label class="block">
        <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-bip-muted">Comprimento (cm)</span>
        <input v-model.number="lengthCm" type="number" min="0.01" step="0.01" placeholder="Ex.: 20" class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]" />
        <span v-if="errors.length_cm" class="mt-1 block text-[10px] text-red-600">{{ errors.length_cm[0] }}</span>
      </label>
      <label class="block">
        <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-bip-muted">Largura (cm)</span>
        <input v-model.number="widthCm" type="number" min="0.01" step="0.01" placeholder="Ex.: 15" class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]" />
        <span v-if="errors.width_cm" class="mt-1 block text-[10px] text-red-600">{{ errors.width_cm[0] }}</span>
      </label>
      <label class="block">
        <span class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-bip-muted">Altura (cm)</span>
        <input v-model.number="heightCm" type="number" min="0.01" step="0.01" placeholder="Ex.: 10" class="w-full rounded-lg border border-[#D1D5DB] px-3 py-2.5 text-sm outline-none focus:border-[#111827]" />
        <span v-if="errors.height_cm" class="mt-1 block text-[10px] text-red-600">{{ errors.height_cm[0] }}</span>
      </label>
    </div>
  </section>
</template>
