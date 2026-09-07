import {
  ref,
  computed,
  onBeforeUnmount,
  getCurrentInstance,
} from "vue";
import type { Product } from "../schemas/product.schema";
import ProductService from "../services/product.service";
import { Logger } from "../services/logger";
import { formatBRL } from "../utils/formatters";
import { useToast } from "./useToast";
import {
  isAxiosError,
  getErrorMessage,
  buildErrorContext,
  type ApplicationError,
} from "../types/errors";
import {
  type ProductFilterPayload,
  type FilterState,
  createDefaultFilterState,
  hasActiveFilters,
  DEFAULT_DEBOUNCE_CONFIG,
} from "../types/filters";
import type { StockMovement, StockMovementInput } from "../types/stockMovement";
import { debounce } from "../utils/debounce";
import { isLowStock, isOutOfStock } from "../utils/stockAlerts";

// Estado FORA da função para funcionar como singleton (mesmo padrão de
// useCategories/useCurrentStore): paginas diferentes do dashboard (Visao
// Geral, Produtos) podem chamar useProducts() sem duplicar fetch/estado.
const products = ref<Product[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const filters = ref<FilterState>(createDefaultFilterState());
const isSearching = ref(false);
const selectedAssetIds = ref<Set<number>>(new Set());
let debouncedSearch: ReturnType<typeof debounce> | null = null;

/**
 * Product Management Composable
 *
 * Manages product state, CRUD operations, business logic calculations,
 * and advanced filtering with debounced search.
 *
 * Features:
 * - Full CRUD operations for products
 * - Server-side filtering with debouncing
 * - Real-time search across name, SKU, and description
 * - Category, availability, and price range filtering
 * - Automatic filter state persistence
 */
export function useProducts() {
  const toast = useToast();

  // ==========================================
  // HELPERS
  // ==========================================

  /**
   * Extract stock quantity from product, handling field name variations.
   *
   * Handles legacy/alternative field names to support multiple data sources.
   */
  const _getStockValue = (product: Product): number => {
    const stockValue = product.stock_quantity ??
                       (product as Record<string, unknown>).stock ??
                       0;
    return Number(stockValue);
  };

  /**
   * Convert product data to FormData for multipart uploads.
   *
   * Validates image file size and handles object references properly.
   * Omits null/undefined values to avoid sending unnecessary data.
   *
   * @param data Product data to convert
   * @param options.partialUpdate When true (edit / PATCH), an emptied
   *   free-text field (description, size) is sent as an explicit '' so the
   *   backend clears it. On create it is omitted like every other empty
   *   value, so a never-filled `size` keeps its NULL default instead of
   *   becoming '' -- preserving the pre-existing create contract.
   * @returns FormData ready for API submission
   * @throws Error if image exceeds 2MB limit
   */
  const _preparePayload = (
    data: Partial<Product>,
    options: { partialUpdate?: boolean } = {},
  ): FormData => {
    const formData = new FormData();
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    const orderedExistingImages: Array<{ index: number; value: string }> = [];
    const orderedUploadedImages: Array<{ index: number; value: File }> = [];

    Object.entries(data).forEach(([key, value]) => {
      // low_stock_threshold is nullable by design (null = "use the default
      // threshold"), unlike every other field here where null/""/undefined
      // just means "don't touch this field". It must be sent as an explicit
      // empty string so the backend clears it back to null instead of
      // silently leaving a stale value in place -- DRF's multipart parsing
      // already maps '' -> None for nullable fields (verified against the
      // live dev server), so no backend change is needed for this.
      if (key === "low_stock_threshold") {
        formData.append(key, value === null || value === undefined ? "" : String(value));
        return;
      }

      // Free-text fields the edit form binds directly. Everywhere else an
      // empty value means "leave this field untouched" (partial update), but
      // on an edit an empty input is a deliberate "clear it" -- dropping it
      // is why a wiped description/size silently reverted on reload. The
      // backend already accepts '' for both (TextField/CharField blank). On
      // create we still omit an empty value (falls through below), so a
      // never-filled `size` keeps its NULL default.
      if ((key === "description" || key === "size") && options.partialUpdate) {
        formData.append(key, value === null || value === undefined ? "" : String(value));
        return;
      }

      if (value === null || value === undefined || value === "") return;

      if (key === "variants" && Array.isArray(value)) {
        const variantsPayload: Array<Record<string, unknown>> = [];

        value.forEach((entry, entryIndex) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return;
          }

          const variant = entry as Record<string, unknown>;
          const name = typeof variant.name === "string" ? variant.name.trim() : "";

          if (!name) {
            return;
          }

          const payloadIndex = variantsPayload.length;
          const position = Number(variant.position);
          const stockQuantity = Number(variant.stock_quantity);
          // null / empty -> the backend treats it as "inherit the base price".
          const rawPrice = variant.price;
          const numericPrice =
            rawPrice === null || rawPrice === undefined || rawPrice === ""
              ? null
              : Number(rawPrice);
          const payload: Record<string, unknown> = {
            name,
            color_hex: String(variant.color_hex || "#000000").toUpperCase(),
            price:
              numericPrice !== null && Number.isFinite(numericPrice) && numericPrice >= 0
                ? numericPrice
                : null,
            stock_quantity: Number.isFinite(stockQuantity)
              ? Math.max(0, Math.trunc(stockQuantity))
              : 0,
            is_active: variant.is_active !== false,
            position: Number.isFinite(position) ? Math.trunc(position) : entryIndex,
          };

          const id = Number(variant.id);
          if (Number.isInteger(id) && id > 0) {
            payload.id = id;
          }

          const image = variant.image;
          if (image instanceof File) {
            if (image.size > MAX_FILE_SIZE) {
              throw new Error("Image file size cannot exceed 2MB.");
            }

            formData.append(`variant_images[${payloadIndex}]`, image);
            payload.image_upload_index = payloadIndex;
          } else if (typeof image === "string" && image.trim()) {
            payload.image = image.trim();
          } else if (image === null) {
            payload.image = null;
          }

          variantsPayload.push(payload);
        });

        formData.append("variants_payload", JSON.stringify(variantsPayload));
        return;
      }

      // Handle cover image file validation
      if (key === "image") {
        if (value instanceof File) {
          if (value.size > MAX_FILE_SIZE) {
            throw new Error("Image file size cannot exceed 2MB.");
          }
          formData.append(key, value);
        } else if (typeof value === "string" && value.trim()) {
          orderedExistingImages.push({ index: 0, value });
        }
        return;
      }

      // Handle gallery image files and persisted urls while preserving slot order.
      if (key === "images" && Array.isArray(value)) {
        const hasCoverSlot = data.image instanceof File || (typeof data.image === "string" && data.image.trim() !== "");

        value.slice(0, 3).forEach((entry, galleryIndex) => {
          const slotIndex = hasCoverSlot ? galleryIndex + 1 : galleryIndex;

          if (entry instanceof File) {
            if (entry.size > MAX_FILE_SIZE) {
              throw new Error("Image file size cannot exceed 2MB.");
            }

            orderedUploadedImages.push({ index: slotIndex, value: entry });
            return;
          }

          if (typeof entry === "string" && entry.trim()) {
            orderedExistingImages.push({ index: slotIndex, value: entry });
          }
        });
        return;
      }

      // Handle numeric fields
      if (key === "price" || key === "stock_quantity") {
        formData.append(key, String(value === "" ? 0 : value));
      }
      // Handle related objects (extract ID)
      else if (
        typeof value === "object" &&
        value !== null &&
        "id" in value
      ) {
        formData.append(key, String((value as Record<string, unknown>).id));
      }
      // Handle all other values as strings
      else {
        formData.append(key, String(value));
      }
    });

    orderedExistingImages
      .sort((left, right) => left.index - right.index)
      .forEach(({ index, value }) => {
        formData.append(`existing_images[${index}]`, value);
      });

    orderedUploadedImages
      .sort((left, right) => left.index - right.index)
      .forEach(({ index, value }) => {
        formData.append(`uploaded_images[${index}]`, value);
      });

    return formData;
  };

  /**
   * Extract error message from API response.
   *
   * Handles various error response formats from backend, including
   * Django REST framework field validation errors.
   */
  const _extractErrorMessage = (error: unknown): string => {
    if (isAxiosError(error)) {
      const data = error.response?.data;

      // Handle Django REST framework field validation errors
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const fieldErrors = Object.entries(data)
          .filter(([, value]) => Array.isArray(value) && value.length > 0)
          .map(([field, messages]) => `${field}: ${(messages as string[]).join(', ')}`)
          .join('; ');

        if (fieldErrors) {
          return fieldErrors;
        }
      }

      // Fallback to standard error formats
      return (
        data?.detail ||
        data?.message ||
        error.message ||
        "Unknown connection error"
      );
    }

    return getErrorMessage(error, "Unknown connection error");
  };

  // ==========================================
  // COMPUTED
  // ==========================================

  /**
   * Calculate total revenue from all products.
   *
   * Returns formatted currency string (USD).
   */
  const totalRevenue = computed(() => {
    const total = products.value.reduce((acc, product) => {
      const price = Number(product.price || 0);
      return acc + price * _getStockValue(product);
    }, 0);

    return formatBRL(total);
  });

  /**
   * Products with zero stock or marked unavailable.
   */
  const outOfStockProducts = computed(() => products.value.filter(isOutOfStock));

  /**
   * Products with low but nonzero stock (per-product low_stock_threshold,
   * falling back to DEFAULT_LOW_STOCK_THRESHOLD -- see utils/stockAlerts.ts),
   * sorted ascending by remaining quantity (most critical first). Excludes
   * unavailable products, which already show up in outOfStockProducts.
   */
  const lowStockProducts = computed(() =>
    products.value
      .filter(isLowStock)
      .sort((left, right) => _getStockValue(left) - _getStockValue(right))
  );

  /**
   * Calculate inventory statistics.
   *
   * Tracks total items and the critical-alert count (out-of-stock + low-stock).
   */
  const inventoryStats = computed(() => ({
    totalItems: products.value.reduce((acc, p) => acc + _getStockValue(p), 0),
    lowStockCount: outOfStockProducts.value.length + lowStockProducts.value.length,
  }));

  /**
   * Check if any filters are currently active.
   */
  const hasFilters = computed(() => hasActiveFilters(filters.value));

  /**
   * Check if search is currently processing.
   */
  const isFilteringActive = computed(() => isSearching.value);

  /**
   * Get filter payload for API requests.
   */
  const filterPayload = computed((): Partial<ProductFilterPayload> => ({
    search: filters.value.search || undefined,
    category: filters.value.categoryId || undefined,
    in_stock: filters.value.inStock ?? undefined,
    min_price: filters.value.minPrice ?? undefined,
    max_price: filters.value.maxPrice ?? undefined,
  }));

  // ==========================================
  // BULK SELECTION COMPUTED
  // ==========================================

  /**
   * Check if any assets are currently selected.
   */
  const hasSelectedAssets = computed(() => selectedAssetIds.value.size > 0);

  /**
   * Get the count of selected assets.
   */
  const selectedAssetsCount = computed(() => selectedAssetIds.value.size);

  /**
   * Check if all visible products are selected.
   */
  const isAllSelected = computed(() => {
    if (products.value.length === 0) return false;
    return products.value.every(product => product.id && selectedAssetIds.value.has(product.id));
  });

  /**
   * Check if some (but not all) products are selected.
   */
  const isIndeterminate = computed(() => {
    const selectedCount = selectedAssetIds.value.size;
    return selectedCount > 0 && selectedCount < products.value.length;
  });

  // ==========================================
  // ACTIONS
  // ==========================================

  /**
   * Fetch all products from backend.
   */
  const fetchData = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      products.value = await ProductService.getAll();
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Failed to fetch products: ${errorMessage}`;
      Logger.error(
        "Failed to fetch products",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
        })
      );
    } finally {
      loading.value = false;
    }
  };

  /**
   * Create a new product.
   *
   * Prepares FormData payload and submits to API.
   * Updates local state on success and shows user feedback.
   *
   * @param data Product data to create
   * @returns Created product or undefined if failed
   * @throws Error (after logging) if creation fails
   */
  const createProduct = async (
    data: Partial<Product>
  ): Promise<Product | undefined> => {
    loading.value = true;
    error.value = null;
    try {
      const payload = _preparePayload(data);
      const newProduct = await ProductService.create(payload);

      products.value = [newProduct, ...products.value];
      Logger.info(`Product created successfully [ID: ${newProduct.id}]`);
      toast.success("Produto criado com sucesso.");
      return newProduct;
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Failed to create product: ${errorMessage}`;
      Logger.error(
        "Product creation failed",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
          inputData: Object.fromEntries(
            Object.entries(data).filter(([_, v]) => !(v instanceof File))
          ),
        })
      );
      toast.error("Nao foi possivel salvar o produto. Tente novamente.");
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Update an existing product.
   *
   * @param id Product ID to update
   * @param data Partial product data
   * @returns Updated product
   * @throws Error (after logging) if update fails
   */
  const updateProduct = async (
    id: number,
    data: Partial<Product>
  ): Promise<Product> => {
    loading.value = true;
    error.value = null;
    try {
      const payload = _preparePayload(data, { partialUpdate: true });
      const updatedProduct = await ProductService.update(id, payload);

      products.value = products.value.map((p) =>
        p.id === id ? updatedProduct : p
      );
      Logger.info(`Product updated successfully [ID: ${id}]`);
      toast.success("Produto atualizado com sucesso.");
      return updatedProduct;
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Failed to update product: ${errorMessage}`;
      Logger.error(
        "Product update failed",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
          productId: id,
        })
      );
      toast.error("Nao foi possivel salvar o produto. Tente novamente.");
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Delete a product.
   *
   * Removes product from backend and local state.
   *
   * @param id Product ID to delete
   * @throws Error (after logging) if deletion fails
   */
  const deleteProduct = async (id: number): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      await ProductService.delete(id);
      products.value = products.value.filter((p) => p.id !== id);
      Logger.info(`Product deleted successfully [ID: ${id}]`);
      toast.success("Produto removido com sucesso.");
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Failed to delete product: ${errorMessage}`;
      Logger.error(
        "Product deletion failed",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
          productId: id,
        })
      );
      toast.error("Nao foi possivel remover o produto. Tente novamente.");
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Record a manual stock movement (entrada/saida) for a product.
   *
   * Patches the matching entry in `products.value` with the server's
   * post-movement state (stock_quantity/is_available), same pattern as
   * updateProduct -- keeps outOfStockProducts/lowStockProducts/inventoryStats
   * reactive with no change needed to those computeds.
   *
   * @param id Product ID to adjust
   * @param payload Movement type, quantity, reason, optional notes
   * @returns The created movement
   * @throws Error (after logging) if the movement is rejected (e.g. negative stock)
   */
  const adjustStock = async (
    id: number,
    payload: StockMovementInput
  ): Promise<StockMovement> => {
    loading.value = true;
    error.value = null;
    try {
      const { movement, product: updatedProduct } = await ProductService.createStockMovement(
        id,
        payload
      );

      products.value = products.value.map((p) =>
        p.id === id ? { ...p, ...updatedProduct } : p
      );
      Logger.info(
        `Stock movement recorded [Product: ${id}, Type: ${payload.movement_type}, Qty: ${payload.quantity}]`
      );
      toast.success("Movimentação de estoque registrada com sucesso.");
      return movement;
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Failed to adjust stock: ${errorMessage}`;
      Logger.error(
        "Stock movement failed",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
          productId: id,
          payload,
        })
      );
      toast.error("Nao foi possivel registrar a movimentacao de estoque.");
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Perform filtered search on products.
   *
   * Fetches products matching the current filter state from the backend.
   * Handles debouncing to prevent excessive API calls.
   *
   * @throws Error if search fails
   */
  const performSearch = async (): Promise<void> => {
    isSearching.value = true;
    error.value = null;

    try {
      if (hasFilters.value) {
        products.value = await ProductService.getFiltered(filterPayload.value);
        Logger.info("Filtered search completed", {
          filterCount: Object.values(filterPayload.value).filter(v => v !== undefined).length,
          resultCount: products.value.length,
        });
      } else {
        // If no filters, fetch all products
        products.value = await ProductService.getAll();
      }
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Search failed: ${errorMessage}`;
      Logger.error(
        "Product search failed",
        buildErrorContext(err as ApplicationError, {
          errorMessage,
          filters: filterPayload.value,
        })
      );
      toast.error("Nao foi possivel concluir a busca. Tente novamente.");
    } finally {
      isSearching.value = false;
    }
  };

  /**
   * Initialize debounced search function.
   *
   * This is called once to set up the debounced version of performSearch.
   */
  const initializeDebouncedSearch = (): void => {
    if (!debouncedSearch) {
      debouncedSearch = debounce(performSearch, {
        delay: DEFAULT_DEBOUNCE_CONFIG.delay,
        maxWait: DEFAULT_DEBOUNCE_CONFIG.maxWait,
        trailing: true,
      });
    }
  };

  /**
   * Release debounced callbacks and watchers.
   *
   * Keeps the composable safe when used both inside Vue components
   * and directly inside unit tests or standalone scripts.
   */
  const dispose = (): void => {
    if (debouncedSearch && typeof debouncedSearch === "object" && "cancel" in debouncedSearch) {
      (debouncedSearch as unknown as { cancel: () => void }).cancel?.();
    }

  };

  /**
   * Update filter state and trigger debounced search.
   *
   * @param updates Partial filter state updates
   */
  const updateFilters = (updates: Partial<FilterState>): void => {
    const hasSearchUpdate = Object.prototype.hasOwnProperty.call(updates, "search");
    filters.value = {
      ...filters.value,
      ...updates,
      page: 1, // Reset to first page on filter change
    };

    // Initialize debounced search on first use
    if (!debouncedSearch) {
      initializeDebouncedSearch();
    }

    if (!debouncedSearch) {
      return;
    }

    const debouncedController = debouncedSearch as DebouncedFunctionLike;

    // Free-text search stays debounced; structured filters apply immediately.
    if (hasSearchUpdate) {
      debouncedController();
      return;
    }

    debouncedController.cancel?.();
    void performSearch();
  };

  interface DebouncedFunctionLike {
    (): void;
    cancel?: () => void;
  }

  const cancelPendingSearch = (): void => {
    if (debouncedSearch && typeof debouncedSearch === "object" && "cancel" in debouncedSearch) {
      (debouncedSearch as unknown as { cancel: () => void }).cancel?.();
    }
  };

  /**
   * Update search term with debouncing.
   *
   * @param searchTerm New search term
   */
  const updateSearchTerm = (searchTerm: string): void => {
    updateFilters({ search: searchTerm });
  };

  /**
   * Update category filter.
   *
   * @param categoryId Category ID or null to clear
   */
  const updateCategory = (categoryId: string | number | null): void => {
    updateFilters({ categoryId });
  };

  /**
   * Update availability filter.
   *
   * @param inStock true for in stock, false for out of stock, null for all
   */
  const updateAvailability = (inStock: boolean | null): void => {
    updateFilters({ inStock });
  };

  /**
   * Update price range filters.
   *
   * @param minPrice Minimum price (null for no minimum)
   * @param maxPrice Maximum price (null for no maximum)
   */
  const updatePriceRange = (minPrice: number | null, maxPrice: number | null): void => {
    updateFilters({ minPrice, maxPrice });
  };

  /**
   * Clear all filters and reset to initial state.
   */
  const clearFilters = async (): Promise<void> => {
    filters.value = createDefaultFilterState();
    error.value = null;

    cancelPendingSearch();

    // Fetch all products without filters
    await fetchData();
    Logger.info("All filters cleared");
    toast.info("Filtros removidos.");
  };

  // ==========================================
  // BULK SELECTION ACTIONS
  // ==========================================

  /**
   * Toggle selection of a specific asset.
   *
   * @param assetId Product ID to toggle
   */
  const toggleSelection = (assetId: number): void => {
    if (selectedAssetIds.value.has(assetId)) {
      selectedAssetIds.value.delete(assetId);
    } else {
      selectedAssetIds.value.add(assetId);
    }
    Logger.info(`Asset selection toggled [ID: ${assetId}]`);
  };

  /**
   * Select all visible assets.
   */
  const selectAll = (): void => {
    const allIds = products.value
      .map(p => p.id)
      .filter((id): id is number => id !== undefined);

    selectedAssetIds.value = new Set(allIds);
    Logger.info(`All assets selected [Count: ${allIds.length}]`);
  };

  /**
   * Clear all asset selections.
   */
  const clearSelection = (): void => {
    selectedAssetIds.value.clear();
    Logger.info("Asset selection cleared");
  };

  /**
   * Toggle between selecting every visible asset and clearing the
   * selection entirely -- the decision a "select all" header checkbox
   * needs (select when unchecked/indeterminate, clear when fully checked),
   * kept here rather than in the component so the selection business logic
   * has one home. When the selection is indeterminate (partial),
   * isAllSelected is false, so this completes the selection instead of
   * clearing it -- matches native tri-state checkbox behavior.
   */
  const toggleSelectAll = (): void => {
    if (isAllSelected.value) {
      clearSelection();
    } else {
      selectAll();
    }
  };

  /**
   * Bulk update category for selected assets.
   *
   * @param productIds Array of product IDs to update
   * @param categoryId New category ID
   * @returns Promise that resolves when update is complete
   */
  const bulkUpdateCategory = async (productIds: number[], categoryId: number): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const result = await ProductService.bulkUpdateCategory(productIds, categoryId);

      // Update local state immediately for UI reactivity
      products.value = products.value.map(product => {
        if (result.updated_products.includes(product.id!)) {
          return { ...product, category: result.new_category };
        }
        return product;
      });

      // Clear selection after successful update
      clearSelection();

      Logger.info(`Bulk category update completed [Products: ${productIds.length}, Category: ${categoryId}]`);
      toast.success(`Categoria atualizada em ${productIds.length} produto${productIds.length === 1 ? '' : 's'}.`);
    } catch (err: unknown) {
      const errorMessage = _extractErrorMessage(err);
      error.value = `Bulk update failed: ${errorMessage}`;
      Logger.error(
        "Bulk category update failed",
        buildErrorContext(err as ApplicationError, {
          productIds,
          categoryId,
          errorMessage,
        })
      );
      toast.error("Nao foi possivel atualizar os produtos selecionados.");
      throw err;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Clean up debounced functions on unmount.
   */
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      dispose();
    });
  }

  return {
    // State
    products,
    loading,
    error,
    filters,
    isSearching,
    selectedAssetIds,

    // Computed
    totalRevenue,
    inventoryStats,
    outOfStockProducts,
    lowStockProducts,
    hasFilters,
    isFilteringActive,
    filterPayload,
    hasSelectedAssets,
    selectedAssetsCount,
    isAllSelected,
    isIndeterminate,

    // Actions
    fetchData,
    createProduct,
    updateProduct,
    deleteProduct,
    adjustStock,

    // Search & Filter Actions
    updateFilters,
    updateSearchTerm,
    updateCategory,
    updateAvailability,
    updatePriceRange,
    clearFilters,
    performSearch,
    dispose,

    // Bulk Selection Actions
    toggleSelection,
    selectAll,
    clearSelection,
    toggleSelectAll,
    bulkUpdateCategory,
  };
}
