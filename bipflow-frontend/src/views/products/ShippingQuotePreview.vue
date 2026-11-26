<template>
  <section v-if="enabled" class="my-3 rounded border p-3 text-sm" aria-label="Simulação de frete nacional">
    <p class="font-semibold">Simular frete nacional</p>
    <p>Valores e prazos ilustrativos, não oficiais. {{ confirmable ? 'Confirmação simulada disponível.' : 'A compra nacional ainda não está disponível.' }}</p>
    <label for="shipping-preview-cep">CEP de destino</label>
    <input id="shipping-preview-cep" v-model="cep" maxlength="9" inputmode="numeric" class="block w-full rounded border p-2" />
    <button type="button" :disabled="loading" class="my-2 rounded border p-2" @click="calculate">Simular</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <label v-for="quote in quotes" :key="quote.service" class="block py-1">
      <input v-model="selected" type="radio" :value="quote.service" />
      {{ quote.service === 'economico_simulado' ? 'Econômico' : 'Expresso' }} —
      {{ formatBRL(Number(quote.price)) }} — {{ quote.estimated_days }} dias estimados
    </label>
    <template v-if="selected && confirmable">
      <label>UF <input v-model="state" maxlength="2" class="rounded border p-2" /></label>
      <button type="button" :disabled="!validState" @click="confirmSelection">Usar frete simulado</button>
      <button type="button" @click="clearSelection">Cancelar seleção</button>
    </template>
    <p v-else-if="selected">Opção apenas demonstrativa; não altera o pedido ou o total atual.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import api from '@/services/api'
import type { CartItem, NationalShippingSelection } from '@/types/product'
import { formatBRL } from '@/utils/formatters'

const props = defineProps<{ storeSlug: string; items: CartItem[] }>()
const emit = defineEmits<{ selection: [value: NationalShippingSelection | null] }>()
const confirmable = ref(false)
const state = ref('')
const validState = computed(() => 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(state.value.toUpperCase()))
function clearSelection() { emit('selection', null) }
function confirmSelection() {
  const quote = quotes.value.find(q => q.service === selected.value)
  if (confirmable.value && validState.value && quote) emit('selection', { destination_postal_code: cep.value, state: state.value.toUpperCase(), service: quote.service, expected_price: quote.price })
}
interface Quote { service: string; price: string; estimated_days: number }
const enabled = ref(false)
const cep = ref('')
const quotes = ref<Quote[]>([])
const selected = ref('')
const loading = ref(false)
const error = ref('')
const endpoint = computed(() => 'v1/public/stores/' + encodeURIComponent(props.storeSlug) + '/shipping-quotes/')
const items = computed(() => props.items.map(item => ({ product_id: item.product.id, quantity: item.quantity })))
watch([selected, state], clearSelection, { flush: 'sync' })
onBeforeUnmount(clearSelection)
let revision = 0
let availabilityRevision = 0
watch([cep, items, endpoint], () => {
  clearSelection()
  confirmable.value = false
  revision += 1
  quotes.value = []
  selected.value = ''
  error.value = ''
  loading.value = false
}, { flush: 'sync' })
watch(endpoint, async (url) => {
  const current = ++availabilityRevision
  enabled.value = false
  try {
    const response = await api.get<{ enabled: boolean }>(url)
    if (current === availabilityRevision && endpoint.value === url) enabled.value = response.data?.enabled === true
  } catch {
    // Disabled or unavailable: preserve the existing checkout.
  }
}, { immediate: true, flush: 'sync' })
async function calculate() {
  if (!enabled.value || loading.value) return
  const current = ++revision
  loading.value = true
  error.value = ''
  quotes.value = []
  selected.value = ''
  try {
    const response = await api.post<{ simulated: boolean; quotes: Quote[]; order_confirmation_available?: boolean }>(endpoint.value, {
      destination_postal_code: cep.value, items: items.value,
    })
    if (current === revision && enabled.value && response.data.simulated && Array.isArray(response.data.quotes)) {
      quotes.value = response.data.quotes
      confirmable.value = response.data.order_confirmation_available === true
    }
  } catch {
    if (current === revision) error.value = 'Não foi possível simular o frete. Confira o CEP e os produtos.'
  } finally {
    if (current === revision) loading.value = false
  }
}
</script>
