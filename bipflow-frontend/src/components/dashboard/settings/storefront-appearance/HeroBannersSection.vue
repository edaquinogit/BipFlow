<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { PhotoIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline';
import { useToast } from '@/composables/useToast';
import { Logger } from '@/services/logger';
import { storefrontAppearanceService } from '@/services/storefront-appearance.service';
import { buildErrorContext, type ApplicationError } from '@/types/errors';
import type { StorefrontBanner, StorefrontBannerPayload, StorefrontDestinationType } from '@/types/store';
import {
  STOREFRONT_MEDIA_RULES,
  validateStorefrontMediaFile,
} from '@/utils/storefrontMedia';
import { DESTINATION_OPTIONS, describeFile } from '../storefrontAppearanceEditor';
import type { Category } from '@/schemas/category.schema';
import type { Product as AdminProduct } from '@/schemas/product.schema';

/**
 * Multiple hero-carousel images (Ciclo 9). Reuses the exact same
 * StorefrontBanner CRUD API as the promotions rail below, scoped to
 * `placement: 'hero'` so the two lists never share position numbering.
 *
 * The legacy single-image "Banner principal" fields above (StorefrontAppearance.
 * hero_*) are left untouched -- a store that only ever used that field keeps
 * working exactly as before (the public vitrine falls back to it when this
 * list is empty). Once a merchant adds a banner here, the vitrine's hero
 * carousel switches to this list.
 */
const props = defineProps<{
  categories: Category[];
  products: AdminProduct[];
}>();

interface HeroBannerEditor {
  clientId: string;
  id: number | null;
  image_url: string;
  alt_text: string;
  title: string;
  subtitle: string;
  cta_text: string;
  destination_type: StorefrontDestinationType;
  destination_value: string;
  position: number;
  is_active: boolean;
  pendingFile: File | null;
  pendingPreviewUrl: string | null;
  fileError: string | null;
  saveError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
}

const BANNER_MEDIA_RULES = STOREFRONT_MEDIA_RULES.banner;
const toast = useToast();

const editors = ref<HeroBannerEditor[]>([]);
const isLoading = ref(false);
const isReordering = ref(false);
let nextDraftId = -1;

function buildEditor(banner: StorefrontBanner): HeroBannerEditor {
  return {
    clientId: String(banner.id),
    id: banner.id,
    image_url: banner.image_url,
    alt_text: banner.alt_text,
    title: banner.title,
    subtitle: banner.subtitle,
    cta_text: banner.cta_text,
    destination_type: banner.destination_type,
    destination_value: banner.destination_value,
    position: banner.position,
    is_active: banner.is_active,
    pendingFile: null,
    pendingPreviewUrl: null,
    fileError: null,
    saveError: null,
    isSaving: false,
    isDeleting: false,
  };
}

function buildDraftEditor(): HeroBannerEditor {
  const clientId = `draft-${Math.abs(nextDraftId)}`;
  nextDraftId -= 1;
  return {
    clientId,
    id: null,
    image_url: '',
    alt_text: '',
    title: '',
    subtitle: '',
    cta_text: '',
    destination_type: 'none',
    destination_value: '',
    position: editors.value.length,
    is_active: true,
    pendingFile: null,
    pendingPreviewUrl: null,
    fileError: null,
    saveError: null,
    isSaving: false,
    isDeleting: false,
  };
}

function clearEditorPreview(editor: HeroBannerEditor): void {
  if (editor.pendingPreviewUrl) {
    URL.revokeObjectURL(editor.pendingPreviewUrl);
  }
  editor.pendingPreviewUrl = null;
  editor.pendingFile = null;
}

async function loadBanners(): Promise<void> {
  isLoading.value = true;
  try {
    for (const editor of editors.value) clearEditorPreview(editor);
    const loaded = await storefrontAppearanceService.listBanners('hero');
    editors.value = loaded.map(buildEditor);
  } catch (error: unknown) {
    Logger.error('Hero banners load failed', buildErrorContext(error as ApplicationError, {}));
    editors.value = [];
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  void loadBanners();
});

onBeforeUnmount(() => {
  for (const editor of editors.value) clearEditorPreview(editor);
});

function addBanner(): void {
  editors.value = [...editors.value, buildDraftEditor()];
}

function fileMetaFor(editor: HeroBannerEditor): string {
  return editor.pendingFile ? describeFile(editor.pendingFile) : '';
}

function previewUrlFor(editor: HeroBannerEditor): string {
  return editor.pendingPreviewUrl || editor.image_url;
}

function openImagePicker(clientId: string): void {
  document.getElementById(`hero-banner-file-${clientId}`)?.click();
}

function handleFileChange(editor: HeroBannerEditor, event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;

  const validationError = validateStorefrontMediaFile('banner', file);
  if (validationError) {
    clearEditorPreview(editor);
    editor.fileError = validationError;
    return;
  }

  clearEditorPreview(editor);
  editor.pendingFile = file;
  editor.pendingPreviewUrl = URL.createObjectURL(file);
  editor.fileError = null;
}

function removeImage(editor: HeroBannerEditor): void {
  clearEditorPreview(editor);
  editor.image_url = '';
  editor.fileError = null;
}

function handleDestinationTypeChange(editor: HeroBannerEditor): void {
  editor.destination_value = '';
}

function buildPayload(editor: HeroBannerEditor, imageUrl: string): StorefrontBannerPayload {
  return {
    placement: 'hero',
    image_url: imageUrl,
    alt_text: editor.alt_text,
    title: editor.title,
    subtitle: editor.subtitle,
    cta_text: editor.cta_text,
    destination_type: editor.destination_type,
    destination_value: editor.destination_value,
    is_active: editor.is_active,
  };
}

async function saveBanner(editor: HeroBannerEditor): Promise<void> {
  if (editor.isSaving) return;

  editor.saveError = null;

  if (!editor.pendingFile && !editor.image_url) {
    editor.saveError = 'Selecione uma imagem para o banner.';
    return;
  }

  editor.isSaving = true;
  try {
    let imageUrl = editor.image_url;
    if (editor.pendingFile) {
      const uploaded = await storefrontAppearanceService.uploadMedia('banner', editor.pendingFile);
      imageUrl = uploaded.url;
    }

    const payload = buildPayload(editor, imageUrl);
    if (editor.id) {
      await storefrontAppearanceService.updateBanner(editor.id, payload);
    } else {
      await storefrontAppearanceService.createBanner(payload);
    }

    toast.success('Banner principal salvo com sucesso.');
    await loadBanners();
  } catch (error: unknown) {
    Logger.error('Hero banner save failed', buildErrorContext(error as ApplicationError, {}));
    editor.saveError = 'Nao foi possivel salvar este banner. Tente novamente.';
    toast.error('Nao foi possivel salvar o banner principal.');
  } finally {
    editor.isSaving = false;
  }
}

async function deleteBanner(editor: HeroBannerEditor): Promise<void> {
  if (!editor.id) {
    editors.value = editors.value.filter((item) => item.clientId !== editor.clientId);
    return;
  }

  if (!window.confirm('Remover este banner principal? Essa acao nao pode ser desfeita.')) {
    return;
  }

  editor.isDeleting = true;
  try {
    await storefrontAppearanceService.deleteBanner(editor.id);
    toast.success('Banner principal removido.');
    await loadBanners();
  } catch (error: unknown) {
    Logger.error('Hero banner delete failed', buildErrorContext(error as ApplicationError, {}));
    toast.error('Nao foi possivel remover este banner.');
  } finally {
    editor.isDeleting = false;
  }
}

async function moveBanner(index: number, direction: -1 | 1): Promise<void> {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= editors.value.length || isReordering.value) {
    return;
  }

  const reordered = [...editors.value];
  const [moved] = reordered.splice(index, 1);
  if (!moved) return;
  reordered.splice(targetIndex, 0, moved);
  const ids = reordered.map((editor) => editor.id).filter((id): id is number => id !== null);
  if (ids.length !== reordered.length) {
    // Unsaved drafts can't be reordered on the server yet.
    return;
  }

  isReordering.value = true;
  try {
    const updated = await storefrontAppearanceService.reorderBanners(ids, 'hero');
    for (const editor of editors.value) clearEditorPreview(editor);
    editors.value = updated.map(buildEditor);
  } catch (error: unknown) {
    Logger.error('Hero banner reorder failed', buildErrorContext(error as ApplicationError, {}));
    toast.error('Nao foi possivel ordenar os banners principais.');
  } finally {
    isReordering.value = false;
  }
}

const isEmpty = computed(() => !isLoading.value && editors.value.length === 0);
</script>

<template>
  <div data-cy="hero-banners-section" class="mt-6 border-t border-[#E5E7EB] pt-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Banner principal (varias imagens)</h3>
        <p class="mt-1 text-xs leading-5 text-bip-muted">
          Adicione mais de uma imagem para alternar automaticamente no topo da vitrine. Ao adicionar o primeiro banner
          aqui, ele substitui o banner unico acima na vitrine publica.
        </p>
      </div>
      <button
        type="button"
        data-cy="btn-add-hero-banner"
        class="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]"
        @click="addBanner"
      >
        <PlusIcon class="h-4 w-4" aria-hidden="true" />
        Adicionar banner
      </button>
    </div>

    <p v-if="isLoading" class="mt-4 text-xs text-bip-muted">Carregando banners principais...</p>

    <div v-else-if="isEmpty" data-cy="hero-banners-empty" class="mt-4 rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-6 text-center">
      <PhotoIcon class="mx-auto h-8 w-8 text-bip-muted" aria-hidden="true" />
      <p class="mt-3 text-sm font-black text-[#05050A]">Nenhum banner principal cadastrado.</p>
      <p class="mx-auto mt-1 max-w-md text-xs leading-5 text-bip-muted">
        Crie duas ou mais imagens para um carrossel automatico. Recomendado: {{ BANNER_MEDIA_RULES.recommendedSize }}.
      </p>
      <button
        type="button"
        class="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]"
        @click="addBanner"
      >
        <PlusIcon class="h-4 w-4" aria-hidden="true" />
        Adicionar primeiro banner
      </button>
    </div>

    <ul v-else class="mt-4 space-y-4">
      <li
        v-for="(editor, index) in editors"
        :key="editor.clientId"
        data-cy="hero-banner-card"
        class="rounded-lg border border-[#E5E7EB] bg-white p-4"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Imagem {{ index + 1 }}</span>
            <input
              :id="`hero-banner-file-${editor.clientId}`"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              class="sr-only"
              @change="handleFileChange(editor, $event)"
            />
            <div v-if="previewUrlFor(editor)" class="overflow-hidden rounded-lg border border-[#E5E7EB] bg-zinc-50">
              <img
                data-cy="hero-banner-preview"
                :src="previewUrlFor(editor)"
                :alt="editor.alt_text || `Preview do banner ${index + 1}`"
                class="aspect-[16/7] w-full object-cover"
              />
            </div>
            <div v-else class="flex aspect-[16/7] flex-col items-center justify-center rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] text-center">
              <PhotoIcon class="h-8 w-8 text-bip-muted" aria-hidden="true" />
              <p class="mt-2 text-xs font-black uppercase tracking-widest text-[#4B5563]">Sem imagem ainda</p>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" data-cy="btn-select-hero-banner" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827]" @click="openImagePicker(editor.clientId)">
                Selecionar imagem
              </button>
              <button type="button" data-cy="btn-remove-hero-banner-image" :disabled="!previewUrlFor(editor)" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="removeImage(editor)">
                Remover imagem
              </button>
              <span v-if="fileMetaFor(editor)" class="text-[11px] font-semibold text-[#4B5563]">{{ fileMetaFor(editor) }}</span>
            </div>
            <p class="mt-1 text-[11px] leading-5 text-bip-muted">PNG, JPG, JPEG ou WEBP ate 5 MB. Recomendado: {{ BANNER_MEDIA_RULES.recommendedSize }}.</p>
            <p v-if="editor.fileError" class="mt-1 text-xs font-semibold text-[#111827]">{{ editor.fileError }}</p>
          </div>

          <label class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto alternativo</span>
            <input v-model="editor.alt_text" data-cy="hero-banner-alt" type="text" maxlength="160" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Titulo (opcional)</span>
            <input v-model="editor.title" data-cy="hero-banner-title" type="text" maxlength="120" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Subtitulo (opcional)</span>
            <input v-model="editor.subtitle" data-cy="hero-banner-subtitle" type="text" maxlength="200" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto do botao (opcional)</span>
            <input v-model="editor.cta_text" data-cy="hero-banner-cta-text" type="text" maxlength="40" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Ao clicar no banner</span>
            <select v-model="editor.destination_type" data-cy="hero-banner-destination-type" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" @change="handleDestinationTypeChange(editor)">
              <option v-for="option in DESTINATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>

          <label v-if="editor.destination_type === 'category'" class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Categoria</span>
            <select v-model="editor.destination_value" data-cy="hero-banner-destination-category" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
              <option value="">Selecione</option>
              <option v-for="category in props.categories" :key="category.id" :value="String(category.id)">{{ category.name }}</option>
            </select>
          </label>

          <label v-else-if="editor.destination_type === 'product'" class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Produto</span>
            <select v-model="editor.destination_value" data-cy="hero-banner-destination-product" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
              <option value="">Selecione</option>
              <option v-for="product in props.products" :key="product.id" :value="String(product.id)">{{ product.name }}</option>
            </select>
          </label>

          <label v-else-if="editor.destination_type === 'external_url'" class="block">
            <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Link externo</span>
            <input v-model="editor.destination_value" data-cy="hero-banner-destination-link" type="url" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" placeholder="https://..." />
          </label>

          <label class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#4B5563] sm:col-span-2">
            <input v-model="editor.is_active" data-cy="hero-banner-active" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] text-[#111827] focus:ring-[#F3F4F6]" />
            Ativo
          </label>
        </div>

        <p v-if="editor.saveError" class="mt-3 text-xs font-semibold text-[#111827]">{{ editor.saveError }}</p>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#F3F4F6] pt-3">
          <div class="flex items-center gap-1.5">
            <button type="button" data-cy="btn-move-hero-banner-up" :disabled="index === 0 || isReordering || !editor.id" class="inline-flex h-10 items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="moveBanner(index, -1)">
              Mover para cima
            </button>
            <button type="button" data-cy="btn-move-hero-banner-down" :disabled="index === editors.length - 1 || isReordering || !editor.id" class="inline-flex h-10 items-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="moveBanner(index, 1)">
              Mover para baixo
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" data-cy="btn-delete-hero-banner" :disabled="editor.isDeleting" class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="deleteBanner(editor)">
              <TrashIcon class="h-4 w-4" aria-hidden="true" />
              {{ editor.isDeleting ? 'Removendo...' : 'Remover' }}
            </button>
            <button type="button" data-cy="btn-save-hero-banner" :disabled="editor.isSaving" class="h-10 rounded-lg bg-[#111827] px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="saveBanner(editor)">
              {{ editor.isSaving ? 'Salvando...' : 'Salvar' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
