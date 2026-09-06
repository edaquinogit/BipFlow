<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { useCurrentStore } from '@/composables/useCurrentStore';
import { useStorefrontAppearance } from '@/composables/useStorefrontAppearance';
import { useToast } from '@/composables/useToast';
import { categoryService } from '@/services/category.service';
import { Logger } from '@/services/logger';
import productService from '@/services/product.service';
import { storeService } from '@/services/store.service';
import { storefrontAppearanceService } from '@/services/storefront-appearance.service';
import type { Category } from '@/schemas/category.schema';
import type { Product as AdminProduct } from '@/schemas/product.schema';
import { buildErrorContext, type ApplicationError } from '@/types/errors';
import type {
  Store,
  StorefrontAppearance,
  StorefrontBanner,
  StorefrontBannerPayload,
  StorefrontBannerStatus,
  StorefrontDestinationType,
} from '@/types/store';
import {
  STOREFRONT_MEDIA_RULES,
  validateStorefrontMediaFile,
} from '@/utils/storefrontMedia';
import { STOREFRONT_PALETTE_PRESETS } from '@/utils/storefrontPalettePresets';
import StorefrontLivePreview from './StorefrontLivePreview.vue';
import HeroBannersSection from './storefront-appearance/HeroBannersSection.vue';
import {
  ADVANCED_THEME_COLOR_FIELDS,
  CARD_STYLE_OPTIONS,
  CORE_THEME_COLOR_FIELDS,
  DEFAULT_THEME,
  DENSITY_OPTIONS,
  DESTINATION_OPTIONS,
  FONT_PRESET_OPTIONS,
  MOTION_OPTIONS,
  RADIUS_STYLE_OPTIONS,
  SECTIONS,
  SECONDARY_COLOR_FALLBACK,
  areDraftsEqual,
  buildAppearancePayload,
  buildContrastCheck,
  buildDefaultDraft,
  buildDraft,
  buildPaletteFromPrimary,
  buildStorePayload,
  cloneDraft,
  describeFile,
  fixThemeContrast,
  type AppearanceDraft,
  type AppearanceSection,
  type BannerEditor,
  type ContrastCheck,
  type PreviewMode,
  type SetupStep,
  type UploadSurfaceKind,
} from './storefrontAppearanceEditor';
const LOGO_MEDIA_RULES = STOREFRONT_MEDIA_RULES.logo;
const FAVICON_MEDIA_RULES = STOREFRONT_MEDIA_RULES.favicon;
const BANNER_MEDIA_RULES = STOREFRONT_MEDIA_RULES.banner;
const PROMOTION_MEDIA_RULES = STOREFRONT_MEDIA_RULES.promotion;

const { selectedStore, storefrontPath, fetchCurrentStore } = useCurrentStore();
const storeSlug = computed(() => selectedStore.value?.slug);
const { appearance, isLoading, loadError, save } = useStorefrontAppearance(storeSlug);
const toast = useToast();

const activeSection = ref<AppearanceSection>('identidade');
const previewMode = ref<PreviewMode>('desktop');
const showAdvancedColors = ref(false);
const isStorefrontLinkReady = computed(() => Boolean(selectedStore.value?.slug));
const categories = ref<Category[]>([]);
const products = ref<AdminProduct[]>([]);
const isOptionsLoading = ref(false);
const isBannersLoading = ref(false);
const bannerEditors = ref<BannerEditor[]>([]);
const isReorderingBanners = ref(false);
const nextDraftBannerId = ref(-1);
const activePromotionEditorClientId = ref<string | null>(null);

const logoInput = ref<HTMLInputElement | null>(null);
const faviconInput = ref<HTMLInputElement | null>(null);
const heroBannerInput = ref<HTMLInputElement | null>(null);
const pendingLogoFile = ref<File | null>(null);
const pendingFaviconFile = ref<File | null>(null);
const pendingHeroBannerFile = ref<File | null>(null);
const pendingLogoPreviewUrl = ref<string | null>(null);
const pendingFaviconPreviewUrl = ref<string | null>(null);
const pendingHeroBannerPreviewUrl = ref<string | null>(null);
const logoError = ref<string | null>(null);
const faviconError = ref<string | null>(null);
const heroBannerError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const isSaving = ref(false);

const draft = ref<AppearanceDraft>(buildDraft(selectedStore.value, appearance.value));
const savedDraft = ref<AppearanceDraft>(buildDraft(selectedStore.value, appearance.value));
const logoPreviewUrl = computed(() => pendingLogoPreviewUrl.value || draft.value.logo_url);
const faviconPreviewUrl = computed(() => pendingFaviconPreviewUrl.value || draft.value.favicon_url);
const heroPreviewImageUrl = computed(() => pendingHeroBannerPreviewUrl.value || draft.value.hero_image_desktop);
const hasAppearanceChanges = computed(() => (
  Boolean(pendingLogoFile.value || pendingFaviconFile.value || pendingHeroBannerFile.value)
  || !areDraftsEqual(draft.value, savedDraft.value)
));
const previewStoreName = computed(() => (
  draft.value.display_name.trim() || selectedStore.value?.name || 'Loja Principal'
));
const heroPreviewUrl = computed(() => buildDestinationUrl(
  draft.value.hero_destination_type,
  draft.value.hero_destination_value,
));

const previewStyle = computed(() => ({
  '--preview-primary': draft.value.theme.primary,
  '--preview-accent': draft.value.theme.accent,
  '--preview-secondary': draft.value.secondary_color,
  '--preview-background': draft.value.theme.background,
  '--preview-surface': draft.value.theme.surface,
  '--preview-text': draft.value.theme.text,
  '--preview-muted': draft.value.theme.muted,
  '--preview-radius': draft.value.radius_style === 'minimal'
    ? '0.35rem'
    : draft.value.radius_style === 'soft'
      ? '1rem'
      : '0.65rem',
  '--preview-font-body': draft.value.font_preset === 'classic'
    ? 'Georgia, "Times New Roman", serif'
    : 'var(--font-sans)',
  '--preview-font-heading': draft.value.font_preset === 'editorial'
    ? 'var(--font-display)'
    : draft.value.font_preset === 'classic'
      ? 'Georgia, "Times New Roman", serif'
      : 'var(--font-sans)',
  fontFamily: 'var(--preview-font-body)',
}));

const visiblePreviewBanners = computed(() => (
  bannerEditors.value
    .filter((banner) => banner.is_active && (banner.pendingPreviewUrl || banner.image_url))
    .slice(0, 3)
));
const activePromotionEditor = computed(() => (
  bannerEditors.value.find((editor) => editor.clientId === activePromotionEditorClientId.value) ?? null
));
const hasLogoConfigured = computed(() => Boolean(logoPreviewUrl.value));
const hasIdentityConfigured = computed(() => Boolean(
  draft.value.display_name.trim() || draft.value.tagline.trim(),
));
const hasCustomColors = computed(() => (
  JSON.stringify(draft.value.theme) !== JSON.stringify(DEFAULT_THEME)
  || draft.value.secondary_color !== SECONDARY_COLOR_FALLBACK
));
const hasHeroBannerConfigured = computed(() => Boolean(
  draft.value.hero_enabled && heroPreviewImageUrl.value,
));
const setupSteps = computed<SetupStep[]>(() => [
  {
    id: 'logo',
    label: 'Adicionar logo',
    isComplete: hasLogoConfigured.value,
    section: 'identidade',
  },
  {
    id: 'colors',
    label: 'Escolher cores',
    isComplete: hasCustomColors.value,
    section: 'identidade',
  },
  {
    id: 'banner',
    label: 'Criar banner',
    isComplete: hasHeroBannerConfigured.value,
    section: 'banner',
  },
  {
    id: 'review',
    label: 'Revisar vitrine',
    isComplete: hasIdentityConfigured.value && hasCustomColors.value,
    section: 'preview',
  },
]);
const completedSetupSteps = computed(() => setupSteps.value.filter((step) => step.isComplete).length);
const setupProgressPercent = computed(() => Math.round(
  (completedSetupSteps.value / setupSteps.value.length) * 100,
));
const isFirstSetup = computed(() => completedSetupSteps.value < setupSteps.value.length);
const hasUnsavedPromotionChanges = computed(() => bannerEditors.value.some((editor) => (
  !editor.id || Boolean(editor.pendingFile || editor.pendingPreviewUrl)
)));
const hasUnsavedChanges = computed(() => hasAppearanceChanges.value || hasUnsavedPromotionChanges.value);
const logoFileMeta = computed(() => pendingLogoFile.value ? describeFile(pendingLogoFile.value) : '');
const faviconFileMeta = computed(() => pendingFaviconFile.value ? describeFile(pendingFaviconFile.value) : '');
const heroBannerFileMeta = computed(() => pendingHeroBannerFile.value ? describeFile(pendingHeroBannerFile.value) : '');
const contrastChecks = computed<ContrastCheck[]>(() => [
  buildContrastCheck('page-text', 'Texto sobre fundo', draft.value.theme.text, draft.value.theme.background),
  buildContrastCheck('card-text', 'Texto sobre cards', draft.value.theme.text, draft.value.theme.surface),
  buildContrastCheck('primary-button', 'Botao principal', '#FFFFFF', draft.value.theme.primary),
  buildContrastCheck('accent-button', 'Destaque', '#FFFFFF', draft.value.theme.accent),
]);
const failedContrastChecks = computed(() => contrastChecks.value.filter((check) => !check.isOk));
const hasContrastWarning = computed(() => failedContrastChecks.value.length > 0);
const previewFrameClass = computed(() => (
  previewMode.value === 'mobile'
    ? 'mx-auto max-w-[280px]'
    : 'w-full'
));

watch([selectedStore, appearance], ([store, appearanceValue]) => {
  clearPendingAppearanceFiles();
  const nextDraft = buildDraft(store, appearanceValue);
  draft.value = nextDraft;
  savedDraft.value = cloneDraft(nextDraft);
});

watch(storeSlug, () => {
  void loadBanners();
});

onMounted(() => {
  void loadDestinationOptions();
  void loadBanners();
  window.addEventListener('beforeunload', handleBeforeUnload);
});

onBeforeUnmount(() => {
  clearPendingAppearanceFiles();
  clearBannerPreviewUrls();
  window.removeEventListener('beforeunload', handleBeforeUnload);
});

function clearObjectUrl(target: Ref<string | null>): void {
  if (target.value) {
    URL.revokeObjectURL(target.value);
    target.value = null;
  }
}

function clearPendingAppearanceFiles(): void {
  clearObjectUrl(pendingLogoPreviewUrl);
  clearObjectUrl(pendingFaviconPreviewUrl);
  clearObjectUrl(pendingHeroBannerPreviewUrl);
  pendingLogoFile.value = null;
  pendingFaviconFile.value = null;
  pendingHeroBannerFile.value = null;
  logoError.value = null;
  faviconError.value = null;
  heroBannerError.value = null;

  if (logoInput.value) logoInput.value.value = '';
  if (faviconInput.value) faviconInput.value.value = '';
  if (heroBannerInput.value) heroBannerInput.value.value = '';
}

function clearBannerPreviewUrls(): void {
  for (const editor of bannerEditors.value) {
    if (editor.pendingPreviewUrl) {
      URL.revokeObjectURL(editor.pendingPreviewUrl);
      editor.pendingPreviewUrl = null;
    }
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges.value) return;

  event.preventDefault();
  event.returnValue = '';
}

function activateSection(section: AppearanceSection): void {
  activeSection.value = section;
}

function handleStorefrontLinkClick(event: MouseEvent): void {
  if (!isStorefrontLinkReady.value) {
    event.preventDefault();
    return;
  }

  if (hasAppearanceChanges.value) {
    toast.info('Abrindo a vitrine atual. Alteracoes ainda nao salvas nao aparecerao nela.');
  }
}

function fixContrastAutomatically(): void {
  draft.value.theme = fixThemeContrast(draft.value.theme);
  toast.info('Cores ajustadas para melhorar o contraste.');
}

function generatePaletteFromPrimary(): void {
  const generatedPalette = buildPaletteFromPrimary(draft.value.theme.primary);
  draft.value.theme = generatedPalette.theme;
  draft.value.secondary_color = generatedPalette.secondaryColor;
}

function applyPendingFileObject(kind: UploadSurfaceKind, file: File): void {
  const validationError = validateStorefrontMediaFile(kind, file);
  if (validationError) {
    if (kind === 'logo') logoError.value = validationError;
    if (kind === 'favicon') faviconError.value = validationError;
    if (kind === 'banner') heroBannerError.value = validationError;
    return;
  }

  if (kind === 'logo') {
    clearObjectUrl(pendingLogoPreviewUrl);
    pendingLogoFile.value = file;
    pendingLogoPreviewUrl.value = URL.createObjectURL(file);
    logoError.value = null;
  }

  if (kind === 'favicon') {
    clearObjectUrl(pendingFaviconPreviewUrl);
    pendingFaviconFile.value = file;
    pendingFaviconPreviewUrl.value = URL.createObjectURL(file);
    faviconError.value = null;
  }

  if (kind === 'banner') {
    clearObjectUrl(pendingHeroBannerPreviewUrl);
    pendingHeroBannerFile.value = file;
    pendingHeroBannerPreviewUrl.value = URL.createObjectURL(file);
    draft.value.hero_enabled = true;
    heroBannerError.value = null;
  }
}

function handleFileDrop(event: DragEvent, kind: UploadSurfaceKind): void {
  const file = event.dataTransfer?.files?.[0] ?? null;
  if (!file) return;

  applyPendingFileObject(kind, file);
}

function openLogoPicker(): void {
  logoInput.value?.click();
}

function openFaviconPicker(): void {
  faviconInput.value?.click();
}

function openHeroBannerPicker(): void {
  heroBannerInput.value?.click();
}

function applyPendingFile(
  event: Event,
  kind: UploadSurfaceKind,
): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (!file) return;

  applyPendingFileObject(kind, file);

  if (
    (kind === 'logo' && logoError.value)
    || (kind === 'favicon' && faviconError.value)
    || (kind === 'banner' && heroBannerError.value)
  ) {
    input.value = '';
  }
}

function removeLogo(): void {
  clearObjectUrl(pendingLogoPreviewUrl);
  pendingLogoFile.value = null;
  draft.value.logo_url = '';
  if (logoInput.value) logoInput.value.value = '';
}

function removeFavicon(): void {
  clearObjectUrl(pendingFaviconPreviewUrl);
  pendingFaviconFile.value = null;
  draft.value.favicon_url = '';
  if (faviconInput.value) faviconInput.value.value = '';
}

function removeHeroBanner(): void {
  clearObjectUrl(pendingHeroBannerPreviewUrl);
  pendingHeroBannerFile.value = null;
  draft.value.hero_image_desktop = '';
  draft.value.hero_image_mobile = '';
  draft.value.hero_enabled = false;
  if (heroBannerInput.value) heroBannerInput.value.value = '';
}

function normalizeDestinationValue(
  type: StorefrontDestinationType,
  value: string,
): string {
  if (type === 'none' || type === 'products') {
    return '';
  }
  return String(value || '').trim();
}

function handleHeroDestinationTypeChange(): void {
  draft.value.hero_destination_value = normalizeDestinationValue(
    draft.value.hero_destination_type,
    draft.value.hero_destination_value,
  );
}

function buildDestinationUrl(
  type: StorefrontDestinationType,
  value: string,
): string {
  const slug = selectedStore.value?.slug || 'default';
  const normalizedValue = String(value || '').trim();

  if (type === 'products') {
    return `/l/${slug}/produtos`;
  }

  if (type === 'category' && normalizedValue) {
    return `/l/${slug}/produtos?category=${normalizedValue}`;
  }

  if (type === 'product' && normalizedValue) {
    const product = products.value.find((item) => String(item.id) === normalizedValue);
    const productSlug = typeof product?.slug === 'string' ? product.slug : '';
    const publicCode = typeof product?.public_code === 'string' ? product.public_code : '';
    if (productSlug) return `/l/${slug}/produtos/${productSlug}`;
    if (publicCode) return `/l/${slug}/p/${publicCode}`;
  }

  if (type === 'external_url') {
    return normalizedValue;
  }

  return '';
}

function applyPalettePreset(presetId: string): void {
  const preset = STOREFRONT_PALETTE_PRESETS.find((item) => item.id === presetId);
  if (!preset) return;

  draft.value.theme = { ...preset.theme };
  draft.value.secondary_color = preset.secondaryColor;
}

function restoreDefaultAppearance(): void {
  const confirmed = window.confirm(
    'Restaurar o padrao da vitrine? Isso substituira as configuracoes atuais antes de salvar.',
  );
  if (!confirmed) return;

  clearPendingAppearanceFiles();
  draft.value = buildDefaultDraft();
}

function sourceFailureMessage(source: 'identity' | 'banner' | 'layout' | 'all'): string {
  if (source === 'identity') return 'Nao foi possivel salvar a identidade e as cores.';
  if (source === 'banner') return 'Nao foi possivel salvar o banner.';
  if (source === 'layout') return 'Nao foi possivel salvar o estilo.';
  return 'Nao foi possivel salvar a aparencia da vitrine.';
}

async function handleSaveAppearance(source: 'identity' | 'banner' | 'layout' | 'all'): Promise<void> {
  const store = selectedStore.value;
  if (!store || isSaving.value || !hasAppearanceChanges.value) {
    return;
  }

  isSaving.value = true;
  saveError.value = null;

  try {
    const draftToPersist = cloneDraft(draft.value);

    if (pendingLogoFile.value) {
      const uploadedLogo = await storefrontAppearanceService.uploadMedia('logo', pendingLogoFile.value);
      draftToPersist.logo_url = uploadedLogo.url;
    }

    if (pendingFaviconFile.value) {
      const uploadedFavicon = await storefrontAppearanceService.uploadMedia('favicon', pendingFaviconFile.value);
      draftToPersist.favicon_url = uploadedFavicon.url;
    }

    if (pendingHeroBannerFile.value) {
      const uploadedBanner = await storefrontAppearanceService.uploadMedia('banner', pendingHeroBannerFile.value);
      draftToPersist.hero_enabled = true;
      draftToPersist.hero_image_desktop = uploadedBanner.url;
    }

    draftToPersist.hero_destination_value = normalizeDestinationValue(
      draftToPersist.hero_destination_type,
      draftToPersist.hero_destination_value,
    );

    const storePayload = buildStorePayload(draftToPersist, savedDraft.value);
    const appearancePayload = buildAppearancePayload(draftToPersist, savedDraft.value);
    const shouldUpdateStore = Object.keys(storePayload).length > 0;
    const shouldUpdateAppearance = Object.keys(appearancePayload).length > 0;

    let updatedStore: Store | null = null;
    let updatedAppearance: StorefrontAppearance | null = null;

    if (shouldUpdateStore) {
      updatedStore = await storeService.updateCurrentAppearance(storePayload);
    }

    if (shouldUpdateAppearance) {
      updatedAppearance = await save(appearancePayload);
    }

    if (shouldUpdateStore) {
      await fetchCurrentStore(true);
    }

    const nextDraft = buildDraft(
      updatedStore ?? selectedStore.value ?? store,
      updatedAppearance ?? appearance.value,
    );
    draft.value = nextDraft;
    savedDraft.value = cloneDraft(nextDraft);
    clearPendingAppearanceFiles();
    toast.success('Aparencia da vitrine atualizada com sucesso.');
  } catch (error: unknown) {
    const message = sourceFailureMessage(source);
    Logger.error('Storefront appearance editor save failed', buildErrorContext(error as ApplicationError, {
      source,
      slug: store.slug,
    }));
    saveError.value = `${message} Tente novamente.`;
    toast.error(message);
  } finally {
    isSaving.value = false;
  }
}

function discardAppearanceChanges(): void {
  clearPendingAppearanceFiles();
  draft.value = cloneDraft(savedDraft.value);
  saveError.value = null;
}

async function loadDestinationOptions(): Promise<void> {
  isOptionsLoading.value = true;
  try {
    const [loadedCategories, loadedProducts] = await Promise.all([
      categoryService.getAll(),
      productService.getAll(),
    ]);
    categories.value = loadedCategories;
    products.value = loadedProducts;
  } catch (error: unknown) {
    Logger.warn('Failed to load storefront destination options', buildErrorContext(error as ApplicationError, {}));
    categories.value = [];
    products.value = [];
  } finally {
    isOptionsLoading.value = false;
  }
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildBannerEditor(banner: StorefrontBanner): BannerEditor {
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
    status: banner.status,
    starts_at: toDateTimeLocal(banner.starts_at),
    ends_at: toDateTimeLocal(banner.ends_at),
    pendingFile: null,
    pendingPreviewUrl: null,
    fileError: null,
    saveError: null,
    isSaving: false,
    isDeleting: false,
  };
}

function createDraftBannerEditor(): BannerEditor {
  const clientId = `draft-${Math.abs(nextDraftBannerId.value)}`;
  nextDraftBannerId.value -= 1;
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
    position: bannerEditors.value.length,
    is_active: true,
    status: 'draft',
    starts_at: '',
    ends_at: '',
    pendingFile: null,
    pendingPreviewUrl: null,
    fileError: null,
    saveError: null,
    isSaving: false,
    isDeleting: false,
  };
}

async function loadBanners(): Promise<void> {
  if (!storeSlug.value) {
    clearBannerPreviewUrls();
    bannerEditors.value = [];
    closePromotionEditor();
    return;
  }

  isBannersLoading.value = true;
  try {
    const loadedBanners = await storefrontAppearanceService.listBanners();
    clearBannerPreviewUrls();
    bannerEditors.value = loadedBanners.map(buildBannerEditor);
    if (
      activePromotionEditorClientId.value
      && !bannerEditors.value.some((editor) => editor.clientId === activePromotionEditorClientId.value)
    ) {
      closePromotionEditor();
    }
  } catch (error: unknown) {
    Logger.error('Storefront banners load failed', buildErrorContext(error as ApplicationError, {
      slug: storeSlug.value,
    }));
    bannerEditors.value = [];
  } finally {
    isBannersLoading.value = false;
  }
}

function addPromotionBanner(): void {
  activeSection.value = 'promocoes';
  const editor = createDraftBannerEditor();
  bannerEditors.value = [...bannerEditors.value, editor];
  activePromotionEditorClientId.value = editor.clientId;
}

function openPromotionEditor(editor: BannerEditor): void {
  activePromotionEditorClientId.value = editor.clientId;
}

function closePromotionEditor(): void {
  activePromotionEditorClientId.value = null;
}

function duplicatePromotionBanner(editor: BannerEditor): void {
  const duplicate = createDraftBannerEditor();
  duplicate.image_url = editor.pendingPreviewUrl || editor.image_url;
  duplicate.alt_text = editor.alt_text;
  duplicate.title = editor.title ? `${editor.title} copia` : '';
  duplicate.subtitle = editor.subtitle;
  duplicate.cta_text = editor.cta_text;
  duplicate.destination_type = editor.destination_type;
  duplicate.destination_value = editor.destination_value;
  duplicate.is_active = false;
  duplicate.status = 'draft';
  duplicate.starts_at = editor.starts_at;
  duplicate.ends_at = editor.ends_at;

  const index = bannerEditors.value.findIndex((item) => item.clientId === editor.clientId);
  const nextEditors = [...bannerEditors.value];
  nextEditors.splice(index >= 0 ? index + 1 : nextEditors.length, 0, duplicate);
  bannerEditors.value = nextEditors.map((item, itemIndex) => ({
    ...item,
    position: itemIndex,
  }));
  activePromotionEditorClientId.value = duplicate.clientId;
  toast.info('Promocao duplicada como rascunho.');
}

function openPromotionImagePicker(editor: BannerEditor): void {
  const input = document.querySelector<HTMLInputElement>(
    `[data-promotion-file-input="${editor.clientId}"]`,
  );
  input?.click();
}

function handlePromotionFileChange(editor: BannerEditor, event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (!file) return;

  const validationError = validateStorefrontMediaFile('promotion', file);
  if (validationError) {
    editor.fileError = validationError;
    input.value = '';
    return;
  }

  if (editor.pendingPreviewUrl) {
    URL.revokeObjectURL(editor.pendingPreviewUrl);
  }
  editor.pendingFile = file;
  editor.pendingPreviewUrl = URL.createObjectURL(file);
  editor.fileError = null;
}

function removePromotionImage(editor: BannerEditor): void {
  if (editor.pendingPreviewUrl) {
    URL.revokeObjectURL(editor.pendingPreviewUrl);
  }
  editor.pendingPreviewUrl = null;
  editor.pendingFile = null;
  editor.image_url = '';
}

function handlePromotionDestinationTypeChange(editor: BannerEditor): void {
  editor.destination_value = normalizeDestinationValue(
    editor.destination_type,
    editor.destination_value,
  );
}

function buildPromotionPayload(editor: BannerEditor, imageUrl: string): StorefrontBannerPayload {
  return {
    image_url: imageUrl,
    alt_text: editor.alt_text,
    title: editor.title,
    subtitle: editor.subtitle,
    cta_text: editor.cta_text,
    destination_type: editor.destination_type,
    destination_value: normalizeDestinationValue(
      editor.destination_type,
      editor.destination_value,
    ),
    position: editor.position,
    is_active: editor.is_active,
    starts_at: fromDateTimeLocal(editor.starts_at),
    ends_at: fromDateTimeLocal(editor.ends_at),
  };
}

async function savePromotionBanner(editor: BannerEditor): Promise<void> {
  if (editor.isSaving) return;

  editor.isSaving = true;
  editor.saveError = null;

  try {
    let imageUrl = editor.image_url;
    if (editor.pendingFile) {
      const uploadedPromotion = await storefrontAppearanceService.uploadMedia('promotion', editor.pendingFile);
      imageUrl = uploadedPromotion.url;
    }

    if (!imageUrl) {
      editor.saveError = 'Selecione uma imagem para o banner promocional.';
      return;
    }

    const payload = buildPromotionPayload(editor, imageUrl);
    if (editor.id) {
      await storefrontAppearanceService.updateBanner(editor.id, payload);
    } else {
      await storefrontAppearanceService.createBanner(payload);
    }

    toast.success('Banner promocional salvo com sucesso.');
    await loadBanners();
    closePromotionEditor();
  } catch (error: unknown) {
    Logger.error('Storefront promotion banner save failed', buildErrorContext(error as ApplicationError, {
      id: editor.id,
      slug: storeSlug.value,
    }));
    editor.saveError = 'Nao foi possivel salvar este banner. Tente novamente.';
    toast.error('Nao foi possivel salvar o banner promocional.');
  } finally {
    editor.isSaving = false;
  }
}

async function deletePromotionBanner(editor: BannerEditor): Promise<void> {
  if (!editor.id) {
    if (editor.pendingPreviewUrl) URL.revokeObjectURL(editor.pendingPreviewUrl);
    bannerEditors.value = bannerEditors.value.filter((item) => item.clientId !== editor.clientId);
    if (activePromotionEditorClientId.value === editor.clientId) {
      closePromotionEditor();
    }
    return;
  }

  editor.isDeleting = true;
  try {
    await storefrontAppearanceService.deleteBanner(editor.id);
    toast.success('Banner promocional removido.');
    await loadBanners();
    closePromotionEditor();
  } catch (error: unknown) {
    Logger.error('Storefront promotion banner delete failed', buildErrorContext(error as ApplicationError, {
      id: editor.id,
      slug: storeSlug.value,
    }));
    editor.saveError = 'Nao foi possivel remover este banner.';
    toast.error('Nao foi possivel remover o banner promocional.');
  } finally {
    editor.isDeleting = false;
  }
}

async function movePromotionBanner(index: number, direction: -1 | 1): Promise<void> {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= bannerEditors.value.length || isReorderingBanners.value) {
    return;
  }

  const current = [...bannerEditors.value];
  const source = current[index];
  const target = current[targetIndex];
  if (!source?.id || !target?.id) {
    return;
  }

  current[index] = target;
  current[targetIndex] = source;
  isReorderingBanners.value = true;

  try {
    const ids = current.filter((editor) => editor.id).map((editor) => editor.id as number);
    const updatedBanners = await storefrontAppearanceService.reorderBanners(ids);
    clearBannerPreviewUrls();
    bannerEditors.value = updatedBanners.map(buildBannerEditor);
  } catch (error: unknown) {
    Logger.error('Storefront promotion banner reorder failed', buildErrorContext(error as ApplicationError, {
      slug: storeSlug.value,
    }));
    toast.error('Nao foi possivel ordenar os banners promocionais.');
  } finally {
    isReorderingBanners.value = false;
  }
}

function statusLabel(statusValue: StorefrontBannerStatus | 'draft'): string {
  if (statusValue === 'active') return 'Ativo';
  if (statusValue === 'scheduled') return 'Agendado';
  if (statusValue === 'expired') return 'Expirado';
  if (statusValue === 'inactive') return 'Inativo';
  return 'Novo';
}
</script>

<template>
  <section class="space-y-5">
    <div class="rounded-lg border border-[#E5E7EB] bg-white p-4 shadow-card sm:p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="max-w-3xl">
          <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Editor da vitrine</p>
          <h2 class="mt-1 text-2xl font-black tracking-normal text-[#05050A]">Personalize sua vitrine</h2>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-bip-muted">
            Deixe sua loja com a cara da sua marca. As alteracoes so ficam publicas depois que voce salvar.
          </p>
          <p v-if="hasAppearanceChanges" class="mt-2 text-xs font-semibold text-[#9F1239]">
            A vitrine publica ainda mostra a versao salva.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            data-cy="btn-restore-storefront-defaults"
            class="inline-flex h-11 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] transition hover:border-[#111827] hover:text-[#111827]"
            @click="restoreDefaultAppearance"
          >
            Restaurar padrao
          </button>
          <a
            data-cy="open-current-storefront-link"
            :href="isStorefrontLinkReady ? storefrontPath : undefined"
            target="_blank"
            rel="noopener"
            :aria-disabled="!isStorefrontLinkReady"
            :tabindex="isStorefrontLinkReady ? 0 : -1"
            class="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] transition hover:border-[#111827] hover:text-[#111827] aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-100 aria-disabled:text-bip-muted"
            @click="handleStorefrontLinkClick"
          >
            <ArrowTopRightOnSquareIcon class="h-4 w-4" aria-hidden="true" />
            {{ hasAppearanceChanges ? 'Abrir vitrine atual' : 'Ver minha vitrine' }}
          </a>
        </div>
      </div>

      <div
        v-if="isFirstSetup"
        data-cy="storefront-first-setup-progress"
        class="mt-5 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-4"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-black text-[#05050A]">Sua vitrine esta quase pronta</p>
            <p class="mt-1 text-xs leading-5 text-bip-muted">
              Complete alguns passos para deixar sua loja com identidade propria.
            </p>
          </div>
          <div class="min-w-[150px]">
            <p class="text-right text-xs font-black text-[#05050A]">{{ completedSetupSteps }} de {{ setupSteps.length }} concluidos</p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-[#E5E7EB]">
              <div class="h-full rounded-full bg-[#111827]" :style="{ width: `${setupProgressPercent}%` }" />
            </div>
          </div>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            v-for="step in setupSteps"
            :key="step.id"
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition"
            :class="step.isComplete ? 'border-success-border bg-success-soft text-success' : 'border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#111827]/40 hover:text-[#05050A]'"
            @click="activateSection(step.section)"
          >
            <CheckCircleIcon v-if="step.isComplete" class="h-4 w-4 shrink-0" aria-hidden="true" />
            <span v-else class="h-4 w-4 shrink-0 rounded-full border border-current" aria-hidden="true" />
            {{ step.label }}
          </button>
        </div>
      </div>
    </div>

    <nav role="tablist" aria-label="Secoes de aparencia" class="flex w-full gap-1 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white p-1 no-scrollbar">
      <button
        v-for="(section, index) in SECTIONS"
        :key="section.value"
        type="button"
        :data-cy="`storefront-appearance-section-${section.value}`"
        role="tab"
        :aria-selected="activeSection === section.value"
        class="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-all duration-200"
        :class="activeSection === section.value ? 'bg-[#05050A] text-white' : 'text-bip-muted hover:bg-zinc-50 hover:text-[#05050A]'"
        @click="activeSection = section.value"
      >
        <span class="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]">{{ index + 1 }}</span>
        {{ section.label }}
      </button>
    </nav>

    <p v-if="loadError" data-cy="storefront-appearance-load-error" class="mt-4 text-xs font-semibold text-[#111827]">{{ loadError }}</p>
    <p v-else-if="isLoading" data-cy="storefront-appearance-loading" class="mt-4 text-xs text-bip-muted">Carregando aparencia da vitrine...</p>

    <div v-else class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div class="min-w-0 space-y-5">
        <section v-show="activeSection === 'identidade'" data-cy="storefront-identity-colors-section" class="space-y-5">
          <div class="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Identidade da loja</h3>

            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <span class="mb-2 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Logo da loja</span>
                <div
                  class="flex min-h-[132px] gap-3 rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-3 transition hover:border-[#111827]/50"
                  role="button"
                  tabindex="0"
                  @click="openLogoPicker"
                  @keydown.enter.prevent="openLogoPicker"
                  @keydown.space.prevent="openLogoPicker"
                  @dragover.prevent
                  @drop.prevent="handleFileDrop($event, 'logo')"
                >
                  <div class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                    <img v-if="logoPreviewUrl" data-cy="storefront-logo-preview" :src="logoPreviewUrl" alt="Preview do logo" class="h-full w-full object-contain" />
                    <PhotoIcon v-else class="h-7 w-7 text-bip-muted" aria-hidden="true" />
                  </div>

                  <div class="min-w-0 flex-1 space-y-2">
                    <input ref="logoInput" data-cy="storefront-logo-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" class="sr-only" @change="applyPendingFile($event, 'logo')" />
                    <div v-if="!logoPreviewUrl">
                      <p class="text-sm font-black text-[#05050A]">Sua loja ainda esta usando a identidade padrao.</p>
                      <p class="mt-1 text-xs leading-5 text-bip-muted">Arraste uma imagem aqui ou selecione um arquivo.</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" data-cy="btn-select-storefront-logo" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827] hover:text-[#111827]" @click.stop="openLogoPicker">
                        Alterar logo
                      </button>
                      <button type="button" data-cy="btn-remove-storefront-logo" :disabled="!logoPreviewUrl" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click.stop="removeLogo">
                        Remover
                      </button>
                    </div>
                    <p class="text-[11px] leading-5 text-bip-muted">PNG, JPG, JPEG ou WEBP ate 2 MB. Recomendado: {{ LOGO_MEDIA_RULES.recommendedSize }}.</p>
                    <p v-if="logoFileMeta" data-cy="storefront-logo-file-meta" class="text-[11px] font-semibold text-[#4B5563]">{{ logoFileMeta }}</p>
                    <p v-if="logoError" data-cy="storefront-logo-error" class="text-xs font-semibold text-[#111827]">{{ logoError }}</p>
                  </div>
                </div>
              </div>

              <div>
                <span class="mb-2 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Favicon da loja</span>
                <div
                  class="flex min-h-[132px] gap-3 rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-3 transition hover:border-[#111827]/50"
                  role="button"
                  tabindex="0"
                  @click="openFaviconPicker"
                  @keydown.enter.prevent="openFaviconPicker"
                  @keydown.space.prevent="openFaviconPicker"
                  @dragover.prevent
                  @drop.prevent="handleFileDrop($event, 'favicon')"
                >
                  <div class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                    <img v-if="faviconPreviewUrl" data-cy="storefront-favicon-preview" :src="faviconPreviewUrl" alt="Preview do favicon" class="h-full w-full object-contain" />
                    <PhotoIcon v-else class="h-6 w-6 text-bip-muted" aria-hidden="true" />
                  </div>

                  <div class="min-w-0 flex-1 space-y-2">
                    <input ref="faviconInput" data-cy="storefront-favicon-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" class="sr-only" @change="applyPendingFile($event, 'favicon')" />
                    <div v-if="!faviconPreviewUrl">
                      <p class="text-sm font-black text-[#05050A]">Icone da aba do navegador.</p>
                      <p class="mt-1 text-xs leading-5 text-bip-muted">Use uma versao simples da sua marca.</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" data-cy="btn-select-storefront-favicon" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827] hover:text-[#111827]" @click.stop="openFaviconPicker">
                        Alterar favicon
                      </button>
                      <button type="button" :disabled="!faviconPreviewUrl" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click.stop="removeFavicon">
                        Remover
                      </button>
                    </div>
                    <p class="text-[11px] leading-5 text-bip-muted">PNG, JPG, JPEG ou WEBP ate 1 MB. Recomendado: {{ FAVICON_MEDIA_RULES.recommendedSize }}.</p>
                    <p v-if="faviconFileMeta" data-cy="storefront-favicon-file-meta" class="text-[11px] font-semibold text-[#4B5563]">{{ faviconFileMeta }}</p>
                    <p v-if="faviconError" data-cy="storefront-favicon-error" class="text-xs font-semibold text-[#111827]">{{ faviconError }}</p>
                  </div>
                </div>
              </div>

              <label class="block md:col-span-2">
                <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Nome exibido na vitrine</span>
                <input v-model="draft.display_name" data-cy="storefront-display-name" type="text" maxlength="120" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" :placeholder="selectedStore?.name || 'Nome da loja'" />
              </label>

              <label class="block md:col-span-2">
                <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Slogan</span>
                <input v-model="draft.tagline" data-cy="storefront-tagline" type="text" maxlength="160" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" placeholder="Ex.: Catalogo online" />
              </label>
            </div>
          </div>

          <div class="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Cores da marca</h3>
                <p class="mt-1 text-xs leading-5 text-bip-muted">Comece pela cor principal. O preview muda na hora.</p>
              </div>
              <button
                type="button"
                data-cy="btn-generate-storefront-palette"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] transition hover:border-[#111827] hover:text-[#111827]"
                @click="generatePaletteFromPrimary"
              >
                <SparklesIcon class="h-4 w-4" aria-hidden="true" />
                Gerar combinacao
              </button>
            </div>

            <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <button
                v-for="preset in STOREFRONT_PALETTE_PRESETS"
                :key="preset.id"
                type="button"
                data-cy="storefront-palette-preset"
                :data-palette-id="preset.id"
                class="rounded-lg border border-[#E5E7EB] bg-white p-3 text-left transition hover:border-[#111827]/50 hover:bg-[#F9FAFB]"
                @click="applyPalettePreset(preset.id)"
              >
                <span class="block text-[10px] font-black uppercase tracking-widest text-[#05050A]">{{ preset.label }}</span>
                <span class="mt-2 flex gap-1.5" aria-hidden="true">
                  <span
                    v-for="color in [preset.theme.primary, preset.theme.accent, preset.secondaryColor, preset.theme.background]"
                    :key="`${preset.id}-${color}`"
                    class="h-5 w-5 rounded-full border border-black/10"
                    :style="{ backgroundColor: color }"
                  />
                </span>
              </button>
            </div>

            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <label v-for="field in CORE_THEME_COLOR_FIELDS" :key="field.key" class="block">
                <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">{{ field.label }}</span>
                <span class="flex gap-2">
                  <input v-model="draft.theme[field.key]" type="color" class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[#D1D5DB] bg-white p-1" :aria-label="`${field.label} visual`" />
                  <input v-model="draft.theme[field.key]" :data-cy="`storefront-theme-${field.key}`" type="text" maxlength="9" class="h-11 min-w-0 flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 font-mono text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" :aria-label="`${field.label} em HEX`" />
                </span>
                <span class="mt-1 block text-[11px] leading-5 text-bip-muted">{{ field.hint }}</span>
              </label>
            </div>

            <button
              type="button"
              data-cy="btn-toggle-storefront-advanced-colors"
              class="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563] transition hover:border-[#111827] hover:text-[#111827]"
              @click="showAdvancedColors = !showAdvancedColors"
            >
              {{ showAdvancedColors ? 'Ocultar configuracoes avancadas' : 'Configuracoes avancadas' }}
            </button>

            <div v-show="showAdvancedColors" data-cy="storefront-advanced-colors" class="mt-4 grid gap-4 rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 sm:grid-cols-2">
              <label v-for="field in ADVANCED_THEME_COLOR_FIELDS" :key="field.key" class="block">
                <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">{{ field.label }}</span>
                <span class="flex gap-2">
                  <input v-model="draft.theme[field.key]" type="color" class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[#D1D5DB] bg-white p-1" :aria-label="`${field.label} visual`" />
                  <input v-model="draft.theme[field.key]" :data-cy="`storefront-theme-${field.key}`" type="text" maxlength="9" class="h-11 min-w-0 flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 font-mono text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" :aria-label="`${field.label} em HEX`" />
                </span>
                <span class="mt-1 block text-[11px] leading-5 text-bip-muted">{{ field.hint }}</span>
              </label>

              <label class="block">
                <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Secundaria</span>
                <span class="flex gap-2">
                  <input v-model="draft.secondary_color" type="color" class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[#D1D5DB] bg-white p-1" aria-label="Secundaria visual" />
                  <input v-model="draft.secondary_color" data-cy="storefront-secondary-color" type="text" maxlength="9" class="h-11 min-w-0 flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 font-mono text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" aria-label="Secundaria em HEX" />
                </span>
                <span class="mt-1 block text-[11px] leading-5 text-bip-muted">Apoio visual para detalhes da vitrine.</span>
              </label>
            </div>

            <div
              data-cy="storefront-contrast-panel"
              class="mt-5 rounded-lg border p-3"
              :class="hasContrastWarning ? 'border-warning-border bg-warning-soft' : 'border-success-border bg-success-soft'"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex gap-2">
                  <ExclamationTriangleIcon v-if="hasContrastWarning" class="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <CheckCircleIcon v-else class="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <div>
                    <p class="text-xs font-black" :class="hasContrastWarning ? 'text-warning' : 'text-success'">
                      {{ hasContrastWarning ? 'Baixo contraste detectado' : 'Contraste adequado' }}
                    </p>
                    <p class="mt-1 text-[11px] leading-5 text-[#4B5563]">
                      {{ hasContrastWarning ? 'Alguns textos podem ficar dificeis de ler.' : 'As cores principais estao legiveis no preview.' }}
                    </p>
                  </div>
                </div>
                <button
                  v-if="hasContrastWarning"
                  type="button"
                  data-cy="btn-fix-storefront-contrast"
                  class="h-10 rounded-lg bg-[#05050A] px-3 text-[10px] font-black uppercase tracking-widest text-white"
                  @click="fixContrastAutomatically"
                >
                  Corrigir automaticamente
                </button>
              </div>
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <div v-for="check in contrastChecks" :key="check.id" class="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2 text-[11px]">
                  <span class="font-semibold text-[#4B5563]">{{ check.label }}</span>
                  <span :class="check.isOk ? 'text-success' : 'text-warning'" class="font-black">{{ check.ratio.toFixed(1) }}:1</span>
                </div>
              </div>
            </div>
          </div>

          <button type="button" data-cy="btn-save-storefront-identity" :disabled="isSaving || !selectedStore || !hasAppearanceChanges" class="w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted sm:w-auto" @click="handleSaveAppearance('identity')">
            {{ isSaving ? 'Salvando...' : 'Salvar alteracoes' }}
          </button>
        </section>

        <section v-show="activeSection === 'banner'" data-cy="storefront-banner-section" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Banner principal</h3>
              <p class="mt-1 text-xs leading-5 text-bip-muted">Destaque uma promocao, colecao ou mensagem logo no inicio da vitrine.</p>
            </div>
            <label class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#4B5563]">
              <input v-model="draft.hero_enabled" data-cy="storefront-banner-enabled" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] text-[#111827] focus:ring-[#F3F4F6]" />
              Ativo
            </label>
          </div>

          <div v-if="!draft.hero_enabled" data-cy="storefront-banner-empty" class="mt-4 rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-6 text-center">
            <PhotoIcon class="mx-auto h-8 w-8 text-bip-muted" aria-hidden="true" />
            <p class="mt-3 text-sm font-black text-[#05050A]">Crie o destaque da sua vitrine.</p>
            <p class="mx-auto mt-1 max-w-md text-xs leading-5 text-bip-muted">Use uma imagem larga com uma oferta, categoria ou lancamento. Recomendado: {{ BANNER_MEDIA_RULES.recommendedSize }}.</p>
            <button
              type="button"
              class="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]"
              @click="draft.hero_enabled = true"
            >
              <PlusIcon class="h-4 w-4" aria-hidden="true" />
              Criar banner
            </button>
          </div>

          <div v-if="draft.hero_enabled" class="mt-4 grid gap-4 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Imagem do banner</span>
              <input ref="heroBannerInput" data-cy="storefront-banner-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" class="sr-only" @change="applyPendingFile($event, 'banner')" />
              <div
                class="rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-3 transition hover:border-[#111827]/50"
                role="button"
                tabindex="0"
                @click="openHeroBannerPicker"
                @keydown.enter.prevent="openHeroBannerPicker"
                @keydown.space.prevent="openHeroBannerPicker"
                @dragover.prevent
                @drop.prevent="handleFileDrop($event, 'banner')"
              >
                <div v-if="heroPreviewImageUrl" class="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                  <img data-cy="storefront-banner-preview" :src="heroPreviewImageUrl" :alt="draft.hero_alt_text || 'Preview do banner desktop'" class="aspect-[16/7] w-full object-cover" />
                </div>
                <div v-else class="flex aspect-[16/7] flex-col items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-center">
                  <PhotoIcon class="h-8 w-8 text-bip-muted" aria-hidden="true" />
                  <p class="mt-2 text-xs font-black uppercase tracking-widest text-[#4B5563]">Arraste uma imagem aqui</p>
                  <p class="mt-1 text-[11px] text-bip-muted">ou selecione um arquivo</p>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" data-cy="btn-select-storefront-banner" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827] hover:text-[#111827]" @click.stop="openHeroBannerPicker">
                    Alterar imagem
                  </button>
                  <button type="button" data-cy="btn-remove-storefront-banner" :disabled="!heroPreviewImageUrl" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click.stop="removeHeroBanner">
                    Remover
                  </button>
                  <span v-if="heroBannerFileMeta" data-cy="storefront-banner-file-meta" class="text-[11px] font-semibold text-[#4B5563]">{{ heroBannerFileMeta }}</span>
                </div>
              </div>
              <p class="mt-2 text-[11px] leading-5 text-bip-muted">PNG, JPG, JPEG ou WEBP ate 5 MB. Recomendado: {{ BANNER_MEDIA_RULES.recommendedSize }}.</p>
              <p class="mt-1 text-[11px] leading-5 text-bip-muted">A imagem pode ser cortada em telas menores. Confira no preview mobile antes de salvar.</p>
              <p v-if="heroBannerError" data-cy="storefront-banner-file-error" class="mt-1 text-xs font-semibold text-[#111827]">{{ heroBannerError }}</p>
            </div>

            <label class="block sm:col-span-2">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto alternativo</span>
              <input v-model="draft.hero_alt_text" data-cy="storefront-banner-alt" type="text" maxlength="160" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Titulo</span>
              <input v-model="draft.hero_title" data-cy="storefront-banner-title" type="text" maxlength="120" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Subtitulo</span>
              <input v-model="draft.hero_subtitle" data-cy="storefront-banner-subtitle" type="text" maxlength="200" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto do botao</span>
              <input v-model="draft.hero_cta_text" data-cy="storefront-banner-cta-text" type="text" maxlength="40" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" placeholder="Ex.: Ver produtos" />
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Ao clicar no banner</span>
              <select v-model="draft.hero_destination_type" data-cy="storefront-banner-destination-type" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" @change="handleHeroDestinationTypeChange">
                <option v-for="option in DESTINATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <label v-if="draft.hero_destination_type === 'category'" class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Categoria</span>
              <select v-model="draft.hero_destination_value" data-cy="storefront-banner-destination-category" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option value="">Selecione</option>
                <option v-for="category in categories" :key="category.id" :value="String(category.id)">{{ category.name }}</option>
              </select>
            </label>

            <label v-else-if="draft.hero_destination_type === 'product'" class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Produto</span>
              <select v-model="draft.hero_destination_value" data-cy="storefront-banner-destination-product" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option value="">Selecione</option>
                <option v-for="product in products" :key="product.id" :value="String(product.id)">{{ product.name }}</option>
              </select>
            </label>

            <label v-else-if="draft.hero_destination_type === 'external_url'" class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Link externo</span>
              <input v-model="draft.hero_destination_value" data-cy="storefront-banner-destination-link" type="url" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" placeholder="https://..." />
            </label>

            <p class="text-[11px] leading-5 text-bip-muted sm:col-span-2">
              O botao so aparece na vitrine quando houver texto e destino valido.
            </p>
          </div>

          <button type="button" data-cy="btn-save-storefront-banner" :disabled="isSaving || !hasAppearanceChanges" class="mt-4 w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted sm:w-auto" @click="handleSaveAppearance('banner')">
            {{ isSaving ? 'Salvando...' : 'Salvar alteracoes' }}
          </button>

          <HeroBannersSection :categories="categories" :products="products" />
        </section>

        <section v-show="activeSection === 'promocoes'" data-cy="storefront-promotions-section" class="space-y-4">
          <div class="flex flex-col gap-3 rounded-lg border border-[#E5E7EB] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Banners promocionais</h3>
              <p class="mt-1 text-xs leading-5 text-bip-muted">Crie campanhas com ordem, status e periodo opcional.</p>
            </div>
            <button type="button" data-cy="btn-add-storefront-promotion" class="h-10 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]" @click="addPromotionBanner">
              Novo banner
            </button>
          </div>

          <p v-if="isBannersLoading" class="text-xs text-bip-muted">Carregando banners promocionais...</p>

          <div v-else-if="!bannerEditors.length" data-cy="storefront-promotions-empty" class="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-6 text-center">
            <PhotoIcon class="mx-auto h-8 w-8 text-bip-muted" aria-hidden="true" />
            <p class="mt-3 text-sm font-black text-[#05050A]">Voce ainda nao possui promocoes visuais.</p>
            <p class="mx-auto mt-1 max-w-md text-xs leading-5 text-bip-muted">Crie banners para destacar ofertas, categorias ou produtos sem alterar o restante da vitrine.</p>
            <button
              type="button"
              class="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]"
              @click="addPromotionBanner"
            >
              <PlusIcon class="h-4 w-4" aria-hidden="true" />
              Criar primeira promocao
            </button>
          </div>

          <article v-for="(editor, index) in bannerEditors" :key="editor.clientId" data-cy="storefront-promotion-card" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div class="flex flex-col gap-4 md:flex-row md:items-center">
              <div class="w-full overflow-hidden rounded-lg border border-[#E5E7EB] bg-zinc-50 md:w-48">
                <img v-if="editor.pendingPreviewUrl || editor.image_url" data-cy="storefront-promotion-preview" :src="editor.pendingPreviewUrl || editor.image_url" :alt="editor.alt_text || editor.title || 'Preview do banner promocional'" class="aspect-[5/3] w-full object-cover" />
                <div v-else class="flex aspect-[5/3] items-center justify-center text-[10px] font-black uppercase tracking-widest text-bip-muted">Banner</div>
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="truncate text-base font-black text-[#05050A]">{{ editor.title || 'Promocao sem titulo' }}</h4>
                  <span class="rounded-full border border-[#E5E7EB] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-bip-muted">{{ statusLabel(editor.status) }}</span>
                  <span v-if="!editor.id" class="rounded-full bg-warning-soft px-3 py-1 text-[10px] font-black uppercase tracking-widest text-warning">Rascunho</span>
                </div>
                <p class="mt-1 line-clamp-2 text-xs leading-5 text-bip-muted">{{ editor.subtitle || 'Sem descricao.' }}</p>
                <p class="mt-2 text-[11px] font-semibold text-[#4B5563]">
                  {{ editor.destination_type === 'none' ? 'Sem destino' : DESTINATION_OPTIONS.find((option) => option.value === editor.destination_type)?.label }}
                </p>
                <p v-if="editor.saveError" class="mt-2 text-xs font-semibold text-[#111827]">{{ editor.saveError }}</p>
              </div>

              <div class="flex flex-wrap gap-2 md:max-w-[360px] md:justify-end">
                <button type="button" data-cy="btn-edit-storefront-promotion" class="h-10 rounded-lg bg-[#05050A] px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]" @click="openPromotionEditor(editor)">
                  Editar
                </button>
                <button type="button" data-cy="btn-duplicate-storefront-promotion" class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827] hover:text-[#111827]" @click="duplicatePromotionBanner(editor)">
                  <DocumentDuplicateIcon class="h-4 w-4" aria-hidden="true" />
                  Duplicar
                </button>
                <button type="button" data-cy="btn-delete-storefront-promotion" :disabled="editor.isDeleting" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="deletePromotionBanner(editor)">
                  <TrashIcon v-if="!editor.isDeleting" class="inline h-4 w-4" aria-hidden="true" />
                  {{ editor.isDeleting ? 'Removendo...' : 'Excluir' }}
                </button>
                <button type="button" data-cy="btn-move-storefront-promotion-up" :disabled="index === 0 || isReorderingBanners || !editor.id" class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="movePromotionBanner(index, -1)">
                  <ArrowUpIcon class="h-4 w-4" aria-hidden="true" />
                  Subir
                </button>
                <button type="button" data-cy="btn-move-storefront-promotion-down" :disabled="index === bannerEditors.length - 1 || isReorderingBanners || !editor.id" class="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="movePromotionBanner(index, 1)">
                  <ArrowDownIcon class="h-4 w-4" aria-hidden="true" />
                  Descer
                </button>
              </div>
            </div>
          </article>

          <div v-if="activePromotionEditor" class="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Editar promocao visual">
            <button type="button" class="absolute inset-0 cursor-default bg-[#05050A]/40" aria-label="Fechar editor de promocao" @click="closePromotionEditor" />

            <aside data-cy="storefront-promotion-drawer" class="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-hidden bg-white shadow-float">
              <header class="flex items-start justify-between gap-4 border-b border-[#E5E7EB] p-4">
                <div>
                  <p class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Promocao visual</p>
                  <h3 class="mt-1 text-lg font-black text-[#05050A]">{{ activePromotionEditor.id ? 'Editar promocao' : 'Nova promocao' }}</h3>
                  <p class="mt-1 text-xs leading-5 text-bip-muted">Configure imagem, periodo, status e destino sem poluir a lista de campanhas.</p>
                </div>
                <button type="button" class="flex h-10 w-10 items-center justify-center rounded-lg border border-[#D1D5DB] text-[#4B5563] hover:border-[#111827] hover:text-[#111827]" aria-label="Fechar" @click="closePromotionEditor">
                  <XMarkIcon class="h-5 w-5" aria-hidden="true" />
                </button>
              </header>

              <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <div class="grid gap-5">
                  <div>
                    <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Imagem</span>
                    <div class="rounded-lg border border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-3">
                      <div class="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
                        <img v-if="activePromotionEditor.pendingPreviewUrl || activePromotionEditor.image_url" data-cy="storefront-promotion-preview" :src="activePromotionEditor.pendingPreviewUrl || activePromotionEditor.image_url" :alt="activePromotionEditor.alt_text || activePromotionEditor.title || 'Preview do banner promocional'" class="aspect-[5/3] w-full object-cover" />
                        <div v-else class="flex aspect-[5/3] flex-col items-center justify-center text-center">
                          <PhotoIcon class="h-8 w-8 text-bip-muted" aria-hidden="true" />
                          <p class="mt-2 text-xs font-black uppercase tracking-widest text-[#4B5563]">Selecione uma imagem</p>
                        </div>
                      </div>
                      <input :data-promotion-file-input="activePromotionEditor.clientId" data-cy="storefront-promotion-file" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" class="sr-only" @change="handlePromotionFileChange(activePromotionEditor, $event)" />
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button type="button" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#05050A] hover:border-[#111827] hover:text-[#111827]" @click="openPromotionImagePicker(activePromotionEditor)">
                          Alterar imagem
                        </button>
                        <button type="button" :disabled="!(activePromotionEditor.pendingPreviewUrl || activePromotionEditor.image_url)" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="removePromotionImage(activePromotionEditor)">
                          Remover
                        </button>
                      </div>
                      <p class="mt-2 text-[11px] leading-5 text-bip-muted">PNG, JPG, JPEG ou WEBP ate 5 MB. Recomendado: {{ PROMOTION_MEDIA_RULES.recommendedSize }}.</p>
                      <p v-if="activePromotionEditor.fileError" class="mt-1 text-xs font-semibold text-[#111827]">{{ activePromotionEditor.fileError }}</p>
                    </div>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <label class="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#4B5563] sm:col-span-2">
                      <input v-model="activePromotionEditor.is_active" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] text-[#111827] focus:ring-[#F3F4F6]" />
                      Ativo
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Titulo</span>
                      <input v-model="activePromotionEditor.title" data-cy="storefront-promotion-title" type="text" maxlength="120" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto alternativo</span>
                      <input v-model="activePromotionEditor.alt_text" type="text" maxlength="160" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Subtitulo</span>
                      <input v-model="activePromotionEditor.subtitle" type="text" maxlength="200" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Texto do botao</span>
                      <input v-model="activePromotionEditor.cta_text" type="text" maxlength="40" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Ao clicar no banner</span>
                      <select v-model="activePromotionEditor.destination_type" data-cy="storefront-promotion-destination-type" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" @change="handlePromotionDestinationTypeChange(activePromotionEditor)">
                        <option v-for="option in DESTINATION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                      </select>
                    </label>

                    <label v-if="activePromotionEditor.destination_type === 'category'" class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Categoria</span>
                      <select v-model="activePromotionEditor.destination_value" data-cy="storefront-promotion-destination-category" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                        <option value="">Selecione</option>
                        <option v-for="category in categories" :key="category.id" :value="String(category.id)">{{ category.name }}</option>
                      </select>
                    </label>

                    <label v-else-if="activePromotionEditor.destination_type === 'product'" class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Produto</span>
                      <select v-model="activePromotionEditor.destination_value" data-cy="storefront-promotion-destination-product" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                        <option value="">Selecione</option>
                        <option v-for="product in products" :key="product.id" :value="String(product.id)">{{ product.name }}</option>
                      </select>
                    </label>

                    <label v-else-if="activePromotionEditor.destination_type === 'external_url'" class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Link externo</span>
                      <input v-model="activePromotionEditor.destination_value" type="url" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" placeholder="https://..." />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Inicio</span>
                      <input v-model="activePromotionEditor.starts_at" data-cy="storefront-promotion-starts-at" type="datetime-local" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>

                    <label class="block">
                      <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Fim</span>
                      <input v-model="activePromotionEditor.ends_at" data-cy="storefront-promotion-ends-at" type="datetime-local" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]" />
                    </label>
                  </div>

                  <p v-if="activePromotionEditor.saveError" class="text-xs font-semibold text-[#111827]">{{ activePromotionEditor.saveError }}</p>
                </div>
              </div>

              <footer class="flex flex-col gap-2 border-t border-[#E5E7EB] p-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" data-cy="btn-delete-storefront-promotion" :disabled="activePromotionEditor.isDeleting" class="h-11 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563] disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="deletePromotionBanner(activePromotionEditor)">
                  {{ activePromotionEditor.isDeleting ? 'Removendo...' : 'Excluir promocao' }}
                </button>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="h-11 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563]" @click="closePromotionEditor">
                    Cancelar
                  </button>
                  <button type="button" data-cy="btn-save-storefront-promotion" :disabled="activePromotionEditor.isSaving" class="h-11 rounded-lg bg-[#111827] px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="savePromotionBanner(activePromotionEditor)">
                    {{ activePromotionEditor.isSaving ? 'Salvando...' : 'Salvar promocao' }}
                  </button>
                </div>
              </footer>
            </aside>
          </div>
        </section>

        <section v-show="activeSection === 'estilo'" class="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Estilo da vitrine</h3>
          <p class="mt-1 text-xs leading-5 text-bip-muted">Escolha presets visuais. A vitrine nunca expoe valores tecnicos de CSS.</p>

          <div class="mt-4 grid gap-3 lg:grid-cols-3">
            <button
              v-for="option in CARD_STYLE_OPTIONS"
              :key="option.value"
              type="button"
              class="rounded-lg border p-4 text-left transition"
              :class="draft.card_style === option.value ? 'border-[#05050A] bg-[#05050A] text-white' : 'border-[#E5E7EB] bg-white text-[#05050A] hover:border-[#111827]/50'"
              @click="draft.card_style = option.value"
            >
              <span class="block text-sm font-black">{{ option.label }}</span>
              <span class="mt-1 block text-xs leading-5" :class="draft.card_style === option.value ? 'text-white/75' : 'text-bip-muted'">{{ option.description }}</span>
              <span class="mt-4 grid grid-cols-2 gap-2" aria-hidden="true">
                <span class="h-12 rounded-md border" :class="option.value === 'elevated' ? 'shadow-card' : ''" />
                <span class="h-12 rounded-md border" :class="option.value === 'bordered' ? 'border-[#05050A]' : ''" />
              </span>
            </button>
          </div>

          <div class="mt-5 grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Fonte</span>
              <select v-model="draft.font_preset" data-cy="storefront-font-preset-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option v-for="option in FONT_PRESET_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Cards</span>
              <select v-model="draft.card_style" data-cy="storefront-card-style-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option v-for="option in CARD_STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Arredondamento</span>
              <select v-model="draft.radius_style" data-cy="storefront-radius-style-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option v-for="option in RADIUS_STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Densidade</span>
              <select v-model="draft.density" data-cy="storefront-density-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option v-for="option in DENSITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <label class="block">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Animacoes</span>
              <select v-model="draft.motion_intensity" data-cy="storefront-motion-intensity-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option v-for="option in MOTION_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <label class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#4B5563]">
              <input v-model="draft.motion_enabled" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] text-[#111827] focus:ring-[#F3F4F6]" />
              Ativar animacoes
            </label>

            <label class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#4B5563]">
              <input v-model="draft.decoration_enabled" data-cy="storefront-decoration-enabled" type="checkbox" class="h-4 w-4 rounded border-[#D1D5DB] text-[#111827] focus:ring-[#F3F4F6]" />
              Elementos decorativos
            </label>

            <label v-if="draft.decoration_enabled" class="block sm:col-span-2">
              <span class="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-bip-muted">Tipo de decoracao</span>
              <select v-model="draft.decoration_style" data-cy="storefront-decoration-style-select" class="h-11 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#05050A] outline-none transition focus:border-[#111827] focus:ring-2 focus:ring-[#F3F4F6]">
                <option value="none">Nenhuma</option>
                <option value="circles">Circulos</option>
                <option value="soft-shapes">Formas suaves</option>
                <option value="geometric">Geometrica</option>
              </select>
            </label>
          </div>

          <button type="button" data-cy="btn-save-storefront-layout" :disabled="isSaving || !hasAppearanceChanges" class="mt-4 w-full rounded-lg bg-[#111827] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#111827]/90 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted sm:w-auto" @click="handleSaveAppearance('layout')">
            {{ isSaving ? 'Salvando...' : 'Salvar alteracoes' }}
          </button>
        </section>

        <section v-show="activeSection === 'preview'" class="rounded-lg border border-[#E5E7EB] bg-white p-4 xl:hidden">
          <h3 class="text-[10px] font-black uppercase tracking-widest text-bip-muted">Preview ao vivo</h3>
          <p class="mt-1 text-xs text-bip-muted">O preview tambem fica fixo ao lado no desktop.</p>
        </section>

        <p v-if="saveError" class="text-xs font-semibold text-[#111827]">{{ saveError }}</p>

        <div v-if="hasAppearanceChanges" data-cy="storefront-unsaved-changes" class="sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border border-[#FBCFE8] bg-white p-3 shadow-xl shadow-[#05050A]/10 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-xs font-semibold text-[#4B5563]">Alteracoes nao salvas</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-cy="btn-discard-storefront-appearance" class="h-10 rounded-lg border border-[#D1D5DB] bg-white px-4 text-[10px] font-black uppercase tracking-widest text-[#4B5563]" @click="discardAppearanceChanges">
              Descartar
            </button>
            <button type="button" data-cy="btn-save-storefront-appearance" :disabled="isSaving || !selectedStore" class="h-10 rounded-lg bg-[#111827] px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-bip-muted" @click="handleSaveAppearance('all')">
              {{ isSaving ? 'Salvando...' : 'Salvar alteracoes' }}
            </button>
          </div>
        </div>
      </div>

      <StorefrontLivePreview
        :mode="previewMode"
        :draft="draft"
        :preview-style="previewStyle"
        :preview-frame-class="previewFrameClass"
        :store-name="previewStoreName"
        :logo-url="logoPreviewUrl"
        :favicon-url="faviconPreviewUrl"
        :hero-image-url="heroPreviewImageUrl"
        :hero-preview-url="heroPreviewUrl"
        :banners="visiblePreviewBanners"
        :is-options-loading="isOptionsLoading"
        @update:mode="previewMode = $event"
      />
    </div>
  </section>
</template>
