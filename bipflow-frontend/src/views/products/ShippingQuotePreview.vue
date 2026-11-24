<template>
  <section v-if="enabled" class="my-3 rounded border p-3 text-sm" aria-label="Simulação de frete nacional">
    <p class="font-semibold">Simular frete nacional</p>
    <p>Valores e prazos ilustrativos, não oficiais. A compra nacional ainda não está disponível.</p>
    <label for="shipping-preview-cep">CEP de destino</label>
    <input id="shipping-preview-cep" v-model="cep" maxlength="9" inputmode="numeric" class="block w-full rounded border p-2" />
    <button type="button" :disabled="loading" class="my-2 rounded border p-2" @click="calculate">Simular</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <label v-for="quote in quotes" :key="quote.service" class="block py-1">
      <input v-model="selected" type="radio" :value="quote.service" />
      {{ quote.service === 'economico_simulado' ? 'Econômico' : 'Expresso' }} —
      {{ formatBRL(Number(quote.price)) }} — {{ quote.estimated_days }} dias estimados
    </label>
    <p v-if="selected">Opção apenas demonstrativa; não altera o pedido ou o total atual.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/services/api'
import type { CartItem } from '@/types/product'
import { formatBRL } from '@/utils/formatters'

const props = defineProps<{ storeSlug: string; items: CartItem[] }>()
interface Quote { service: string; price: string; estimated_days: number }
const enabled = ref(false)
const cep = ref('')
const quotes = ref<Quote[]>([])
const selected = ref('')
const loading = ref(false)
const error = ref('')
const endpoint = computed(() => 'v1/public/stores/' + encodeURIComponent(props.storeSlug) + '/shipping-quotes/')
const items = computed(() => props.items.map(item => ({ product_id: item.product.id, quantity: item.quantity })))
let revision = 0
watch([cep, items, endpoint], () => {
  revision += 1
  quotes.value = []
  selected.value = ''
  error.value = ''
  loading.value = false
})
watch(endpoint, async (url) => {
  enabled.value = false
  try {
    const response = await api.get<{ enabled: boolean }>(url)
    if (endpoint.value === url) enabled.value = response.data?.enabled === true
  } catch {
    // Disabled or unavailable: preserve the existing checkout.
  }
}, { immediate: true })
async function calculate() {
  if (!enabled.value || loading.value) return
  const current = ++revision
  loading.value = true
  error.value = ''
  quotes.value = []
  selected.value = ''
  try {
    const response = await api.post<{ simulated: boolean; quotes: Quote[] }>(endpoint.value, {
      destination_postal_code: cep.value, items: items.value,
    })
    if (current === revision && response.data.simulated) quotes.value = response.data.quotes
  } catch {
    if (current === revision) error.value = 'Não foi possível simular o frete. Confira o CEP e os produtos.'
  } finally {
    if (current === revision) loading.value = false
  }
}
</script>
