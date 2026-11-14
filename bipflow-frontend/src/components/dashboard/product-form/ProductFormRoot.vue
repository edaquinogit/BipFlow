<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { CheckIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import { ProductFormSchema, type Product, type ProductFormData } from '@/schemas/product.schema';
import IdentitySection from '@/components/dashboard/product-form/sections/IdentitySection.vue';
import ValuationSection from '@/components/dashboard/product-form/sections/ValuationSection.vue';
import MediaSection from '@/components/dashboard/product-form/sections/MediaSection.vue';
import ProductVariantsSection from '@/components/dashboard/product-form/sections/ProductVariantsSection.vue';
import ShippingDimensionsSection from '@/components/dashboard/product-form/sections/ShippingDimensionsSection.vue';
import { useDialogA11y } from '@/composables/useDialogA11y';

interface Props {
  isOpen: boolean;
  initialData?: Product | null;
  categories: Array<{ id: number; name: string; parent?: number | null; parent_name?: string | null }>;
  isSaving?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  initialData: null,
  categories: () => [],
  isSaving: false,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', data: ProductFormData): void;
}>();

const isSubmitting = ref(false);
const errors = ref<Record<string, string[]>>({});

// isSubmitting only covers local validation; the parent's isSaving spans the
// full async save (including the network round-trip), which can take much
// longer -- combine both so the button stays disabled/spinning for the
// entire operation instead of re-enabling the instant `save` is emitted.
const isBusy = computed(() => isSubmitting.value || props.isSaving);

type ProductFormState = {
  name: string;
  price: number;
  stock_quantity: number;
  low_stock_threshold: number | null;
  category: ProductFormData['category'] | null | undefined;
  size: string;
  image: ProductFormData['image'];
  images: ProductFormData['images'];
  variants: ProductFormData['variants'];
  description: string;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  is_available?: boolean;
};

const createEmptyForm = (): ProductFormState => ({
  name: '',
  price: 0,
  stock_quantity: 0,
  low_stock_threshold: null,
  category: undefined,
  size: '',
  image: null,
  images: [],
  variants: [],
  description: '',
  weight_grams: null,
  length_cm: null,
  width_cm: null,
  height_cm: null,
});

const toNumberOrZero = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const toOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const resolveCategoryId = (
  category: Product['category']
): ProductFormState['category'] => {
  if (!category) {
    return undefined;
  }

  if (typeof category === 'object' && 'id' in category) {
    return category.id;
  }

  return category;
};

const normalizeInitialFormData = (
  product: Product | null | undefined
): ProductFormState => {
  if (!product) {
    return createEmptyForm();
  }

  const coverImage = typeof product.image === 'string' ? product.image : null;
  const productImages = Array.isArray(product.images) ? product.images : [];
  const galleryImages = coverImage
    ? productImages.filter((imageUrl) => imageUrl !== coverImage)
    : productImages;
  const variants = Array.isArray(product.variants)
    ? [...product.variants]
      .sort((left, right) => left.position - right.position || (left.id ?? 0) - (right.id ?? 0))
      .map((variant, index) => ({
        id: variant.id,
        name: variant.name ?? '',
        color_hex: variant.color_hex ?? '#000000',
        price:
          variant.price === null || variant.price === undefined
            ? null
            : toNumberOrZero(variant.price),
        stock_quantity: Math.trunc(toNumberOrZero(variant.stock_quantity)),
        image: variant.image ?? null,
        is_active: variant.is_active ?? true,
        position: index,
      }))
    : [];

  return {
    name: product.name ?? '',
    price: toNumberOrZero(product.price),
    stock_quantity: Math.trunc(toNumberOrZero(product.stock_quantity)),
    low_stock_threshold: product.low_stock_threshold ?? null,
    category: resolveCategoryId(product.category),
    size: product.size ?? '',
    image: product.image ?? null,
    images: galleryImages.slice(0, 2),
    variants,
    description: product.description ?? '',
    weight_grams: toOptionalNumber(product.weight_grams),
    length_cm: toOptionalNumber(product.length_cm),
    width_cm: toOptionalNumber(product.width_cm),
    height_cm: toOptionalNumber(product.height_cm),
    is_available: product.is_available ?? true,
  };
};

const form = ref<ProductFormState>(createEmptyForm());

watch(() => props.isOpen, (isVisible) => {
  if (isVisible) {
    form.value = normalizeInitialFormData(props.initialData);
    errors.value = {};
  }
}, { immediate: true });

const handleSubmit = async () => {
  // Defense in depth: the submit button is already :disabled="isBusy", but
  // an implicit form submission (e.g. Enter in a text field) isn't always
  // blocked by a disabled button the same way a click is -- guard here too
  // so a save already in flight can never be double-submitted.
  if (isBusy.value) {
    return;
  }

  isSubmitting.value = true;
  errors.value = {};

  await new Promise((resolve) => setTimeout(resolve, 50));

  const result = ProductFormSchema.safeParse(form.value);

  if (!result.success) {
    errors.value = result.error.flatten().fieldErrors as Record<string, string[]>;
    isSubmitting.value = false;
    return;
  }

  try {
    emit('save', result.data);
  } finally {
    isSubmitting.value = false;
  }
};

const containerRef = ref<HTMLElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);

useDialogA11y(toRef(props, 'isOpen'), () => emit('close'), containerRef, closeButtonRef);

const title = computed(() => props.initialData ? 'Editar produto' : 'Novo produto');
const subtitle = computed(() => (
  props.initialData ? 'Atualize os dados da vitrine' : 'Cadastre um item para venda'
));
const submitLabel = computed(() => {
  if (isBusy.value) {
    return 'Salvando...';
  }

  return props.initialData ? 'Salvar alterações' : 'Criar produto';
});
</script>

<template>
  <Transition name="slide">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex justify-end">
      <div
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        @click="emit('close')"
      />

      <aside
        ref="containerRef"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="relative flex w-full max-w-xl flex-col overflow-hidden border-l border-[#E5E7EB] bg-white p-6 shadow-2xl shadow-black/10 sm:p-8"
        data-cy="product-form-panel"
      >
        <header class="mb-9 flex shrink-0 items-start justify-between gap-6">
          <div>
            <h2 class="text-2xl font-semibold leading-none tracking-normal text-[#05050A]">
              {{ title }}
            </h2>
            <p class="mt-2 text-sm text-bip-muted">
              {{ subtitle }}
            </p>
          </div>

          <button
            ref="closeButtonRef"
            type="button"
            data-cy="btn-close-form"
            aria-label="Fechar formulário de produto"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-bip-muted transition-all hover:bg-zinc-50 hover:text-[#05050A] active:scale-95"
            @click="emit('close')"
          >
            <XMarkIcon class="h-5 w-5" />
          </button>
        </header>

        <form
          id="product-registry-form"
          class="custom-scrollbar flex-1 space-y-12 overflow-y-auto pr-2"
          @submit.prevent="handleSubmit"
        >
          <IdentitySection
            v-model:name="form.name"
            v-model:description="form.description"
            v-model:category="form.category"
            :categories="categories"
            :errors="errors"
            :public-code="props.initialData?.public_code"
          />

          <ValuationSection
            v-model:price.number="form.price"
            v-model:stock="form.stock_quantity"
            v-model:low-stock-threshold="form.low_stock_threshold"
            v-model:size="form.size"
            :errors="errors"
          />

          <MediaSection
            v-model:cover-image="form.image"
            v-model:gallery-images="form.images"
            :error="errors.image?.[0] || errors.images?.[0] || errors.uploaded_images?.[0]"
          />

          <ProductVariantsSection
            v-model:variants="form.variants"
            :base-price="form.price"
            :error="errors.variants?.[0]"
          />

          <ShippingDimensionsSection
            v-model:weight-grams="form.weight_grams"
            v-model:length-cm="form.length_cm"
            v-model:width-cm="form.width_cm"
            v-model:height-cm="form.height_cm"
            :errors="errors"
          />
        </form>

        <footer class="mt-8 shrink-0 border-t border-[#E5E7EB] pt-5">
          <button
            form="product-registry-form"
            type="submit"
            data-cy="btn-submit-product"
            :disabled="isBusy"
            class="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#111827] px-5 text-sm font-semibold text-white shadow-xl shadow-[#111827]/20 transition-all hover:bg-[#111827]/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span v-if="isBusy" class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <CheckIcon v-else class="h-4 w-4" />
            <span>{{ submitLabel }}</span>
          </button>
        </footer>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #e5e7eb;
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #d1d5db;
}
</style>
