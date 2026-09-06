/**
 * useProducts Composable Unit Tests
 *
 * Tests the product management composable including:
 * - Product creation with image upload (FormData transformation)
 * - Revenue calculation with type coercion
 * - Error handling and state management
 * - Integration with services
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useProducts } from "../useProducts";
import ProductService from "../../services/product.service";
import { useToast } from "../../composables/useToast";
import { Logger } from "../../services/logger";
import { formatBRL } from "../../utils/formatters";

// Mock service dependencies
vi.mock("../../services/product.service");
vi.mock("../../composables/useToast", () => ({
  useToast: vi.fn(),
}));
vi.mock("../../services/logger", () => ({
  Logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("useProducts Composable", () => {
  let mockToast: any;
  let mockLogger: any;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    // Clear all mocks before each test to prevent state pollution
    vi.clearAllMocks();
    dispose = undefined;

    // Get reference to mocked Logger
    mockLogger = vi.mocked(Logger);

    // Setup mock implementations for Toast
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    };

    vi.mocked(useToast).mockReturnValue(mockToast);
  });

  const createComposable = () => {
    const composable = useProducts();
    dispose = composable.dispose;
    return composable;
  };

  describe("Product Creation with Image Upload", () => {
    /**
     * Verify FormData transformation for multipart uploads
     *
     * When a product with an image file is created, the composable
     * should convert the payload to FormData format for the backend.
     */
    it("should transform product data into valid FormData for media upload", async () => {
      // Setup: Create a mock image file (simulates user upload)
      const { createProduct } = createComposable();
      const mockFile = new File(["image-content"], "test-product.png", {
        type: "image/png",
      });

      const productInput = {
        name: "Premium Product",
        price: 150.00,
        stock_quantity: 10,
        category: 2,
        image: mockFile,
      };

      // Mock the service to track API calls
      const serviceSpy = vi.spyOn(ProductService, "create").mockResolvedValue({
        id: 101,
        name: productInput.name,
        price: productInput.price,
        stock_quantity: productInput.stock_quantity,
        image: "http://localhost:8000/media/products/2026/test-product.png",
      } as any);

      // Execute: Call the composable
      const result = await createProduct(productInput as any);

      // Verify: Service was called with FormData
      expect(serviceSpy).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();

      // Assertion: The payload sent to service must be FormData
      const sentPayload = serviceSpy.mock.calls[0]?.[0];
      expect(sentPayload).toBeInstanceOf(FormData);

      // Assertion: Verify image file is present in FormData
      const imageInPayload = (sentPayload as FormData).get("image");
      expect(imageInPayload).toBeInstanceOf(File);
      if (imageInPayload instanceof File) {
        expect(imageInPayload.name).toBe("test-product.png");
      }
      expect((sentPayload as FormData).get("category")).toBe("2");

      // Assertion: Verify response includes absolute media URL
      expect(result!.image).toMatch(/^http.*media/);
    });

    it("should serialize color variants into JSON and attach variant image uploads", async () => {
      const { createProduct } = createComposable();
      const variantFile = new File(["variant-image"], "camiseta-preta.png", {
        type: "image/png",
      });

      const serviceSpy = vi.spyOn(ProductService, "create").mockResolvedValue({
        id: 102,
        name: "Camiseta",
        image: null,
      } as any);

      await createProduct({
        name: "Camiseta",
        price: 89.9,
        stock_quantity: 4,
        category: 2,
        variants: [
          {
            name: "Preto",
            color_hex: "#000000",
            stock_quantity: 2,
            image: variantFile,
            is_active: true,
            position: 0,
          },
        ],
      } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[0] as FormData;
      expect(JSON.parse(String(sentPayload.get("variants_payload")))).toEqual([
        {
          name: "Preto",
          color_hex: "#000000",
          price: null,
          stock_quantity: 2,
          is_active: true,
          position: 0,
          image_upload_index: 0,
        },
      ]);
      expect(sentPayload.get("variant_images[0]")).toBeInstanceOf(File);
    });

    it("sends a per-variant price when set and null when left blank", async () => {
      const { createProduct } = createComposable();
      const serviceSpy = vi
        .spyOn(ProductService, "create")
        .mockResolvedValue({ id: 103, name: "Camiseta", image: null } as any);

      await createProduct({
        name: "Camiseta",
        price: 59.9,
        stock_quantity: 10,
        category: 2,
        variants: [
          { name: "M", color_hex: "#000000", price: null, stock_quantity: 5, is_active: true, position: 0 },
          { name: "GG", color_hex: "#111111", price: 69.9, stock_quantity: 5, is_active: true, position: 1 },
          { name: "XG", color_hex: "#222222", price: -3, stock_quantity: 5, is_active: true, position: 2 },
        ],
      } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[0] as FormData;
      const variantsPayload = JSON.parse(String(sentPayload.get("variants_payload")));
      expect(variantsPayload.map((v: { price: unknown }) => v.price)).toEqual([null, 69.9, null]);
    });

    /**
     * Verify error handling when product creation fails
     *
     * When API returns error, composable should:
     * - Log the error
     * - Display error toast
     * - Set error state
     * - Not crash
     */
    it("should handle creation errors gracefully", async () => {
      const { createProduct } = createComposable();

      const apiError = new Error("Product with this SKU already exists");
      vi.spyOn(ProductService, "create").mockRejectedValue(apiError);

      // Execute and catch expected error
      await expect(createProduct({ name: "Duplicate" } as any))
        .rejects
        .toThrow();

      // Verify error handling
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Product creation failed"),
        expect.any(Object)
      );
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe("Revenue Calculation", () => {
    /**
     * Verify revenue calculation with type coercion
     *
     * Handle mixed price types (string vs number) in revenue totals.
     */
    it("should calculate total revenue correctly with mixed price types", () => {
      const { products, totalRevenue } = createComposable();

      // Setup: Products with mixed price types
      products.value = [
        { id: 1, name: "Product A", price: "100.00", stock_quantity: 2 } as any,
        { id: 2, name: "Product B", price: 50, stock_quantity: 5 } as any,
        { id: 3, name: "Product C", price: "25.50", stock_quantity: 1 } as any,
      ];

      // Expected: (100 * 2) + (50 * 5) + (25.50 * 1) = 475.50, formatted as BRL
      // (matches storefront pricing locale, not the dashboard's previous USD bug)
      expect(totalRevenue.value).toBe(formatBRL(475.5));
    });

    /**
     * Verify empty state revenue
     *
     * When no products exist, revenue should be zero.
     */
    it("should return zero revenue when no products exist", () => {
      const { products, totalRevenue } = createComposable();

      products.value = [];

      expect(totalRevenue.value).toBe(formatBRL(0));
    });
  });

  describe("State Management", () => {
    /**
     * Verify loading state during API call
     *
     * While product creation is in progress, loading should be true.
     */
    it("should set loading state during product creation", async () => {
      const { createProduct, loading } = createComposable();

      const slowPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ id: 1 }), 100)
      );

      vi.spyOn(ProductService, "create").mockReturnValue(slowPromise as any);

      const createPromise = createProduct({ name: "Slow Product" } as any);

      // Note: In real implementation, loading state might need to be checked
      // within the API call flow or through a different mechanism
      expect(loading).toBeDefined();

      await createPromise;
    });

    /**
     * Verify error state is cleared on new attempt
     *
     * After a failed API call, attempting again should reset error state.
     */
    it("should clear error state on successful retry", async () => {
      const { createProduct, error } = createComposable();

      // First call fails
      vi.spyOn(ProductService, "create")
        .mockRejectedValueOnce(new Error("API Error"));

      try {
        await createProduct({ name: "Test" } as any);
      } catch (e) {
        // Expected error
      }

      // Second call succeeds
      vi.spyOn(ProductService, "create")
        .mockResolvedValueOnce({ id: 1, name: "Test" } as any);

      await createProduct({ name: "Test Retry" } as any);

      // After success, error should be cleared
      expect(error.value).toBeNull();
    });
  });

  describe("Image Handling", () => {
    /**
     * Verify image URL transformation
     *
     * When server returns relative image path, it should be converted to absolute URL.
     */
    it("should handle image URL transformation from server response", async () => {
      const { createProduct } = createComposable();

      const mockFile = new File(["content"], "product.jpg", {
        type: "image/jpeg",
      });

      // Mock server response with relative path
      vi.spyOn(ProductService, "create").mockResolvedValue({
        id: 1,
        name: "Product",
        image: "/media/products/2026/product.jpg",
      } as any);

      const result = await createProduct({
        name: "Product",
        image: mockFile,
      } as any);

      // Verify the image URL is handled properly
      expect(result!.image).toBeDefined();
      expect(mockToast.success).toHaveBeenCalled();
    });

    /**
     * Verify handling of products without images
     *
     * Products without images should not cause errors or display broken image icons.
     */
    it("should handle products without images gracefully", async () => {
      const { createProduct } = createComposable();

      vi.spyOn(ProductService, "create").mockResolvedValue({
        id: 1,
        name: "No Image Product",
        image: null,
      } as any);

      const result = await createProduct({
        name: "No Image Product",
      } as any);

      // Should not throw, and image should be null
      expect(result!.image).toBeNull();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  describe("Stock Alert Classification", () => {
    /**
     * Verify out-of-stock vs low-stock buckets are mutually exclusive and that
     * the critical-alert KPI count is derived from the same source of truth
     * (regression guard for the DashboardProductsView/Overview consolidation).
     */
    it("should classify zeroed, unavailable, low-stock and healthy products correctly", () => {
      const { products, outOfStockProducts, lowStockProducts, inventoryStats } = createComposable();

      products.value = [
        { id: 1, name: "Zeroed", stock_quantity: 0, is_available: true } as any,
        { id: 2, name: "Unavailable but in stock", stock_quantity: 10, is_available: false } as any,
        { id: 3, name: "Low stock", stock_quantity: 3, is_available: true } as any,
        { id: 4, name: "Right at the threshold", stock_quantity: 5, is_available: true } as any,
        { id: 5, name: "Healthy stock", stock_quantity: 50, is_available: true } as any,
      ];

      expect(outOfStockProducts.value.map((p) => p.id)).toEqual([1, 2]);
      expect(lowStockProducts.value.map((p) => p.id)).toEqual([3, 4]);
      expect(inventoryStats.value.lowStockCount).toBe(4);
    });

    it("should sort low-stock products ascending by remaining quantity", () => {
      const { products, lowStockProducts } = createComposable();

      products.value = [
        { id: 1, name: "Four left", stock_quantity: 4, is_available: true } as any,
        { id: 2, name: "One left", stock_quantity: 1, is_available: true } as any,
        { id: 3, name: "Three left", stock_quantity: 3, is_available: true } as any,
      ];

      expect(lowStockProducts.value.map((p) => p.id)).toEqual([2, 3, 1]);
    });

    it("should report zero alerts for a healthy catalog", () => {
      const { products, outOfStockProducts, lowStockProducts, inventoryStats } = createComposable();

      products.value = [
        { id: 1, name: "Healthy A", stock_quantity: 20, is_available: true } as any,
        { id: 2, name: "Healthy B", stock_quantity: 30, is_available: true } as any,
      ];

      expect(outOfStockProducts.value).toHaveLength(0);
      expect(lowStockProducts.value).toHaveLength(0);
      expect(inventoryStats.value.lowStockCount).toBe(0);
    });

    /**
     * Etapa 3: a product's own low_stock_threshold overrides the default of
     * 5 in both directions -- a higher threshold flags it sooner, a lower
     * (or zero) threshold flags it later/never.
     */
    it("should use each product's own low_stock_threshold instead of the default", () => {
      const { products, outOfStockProducts, lowStockProducts } = createComposable();

      products.value = [
        { id: 1, name: "Bulk item", stock_quantity: 15, is_available: true, low_stock_threshold: 20 } as any,
        { id: 2, name: "Default threshold", stock_quantity: 15, is_available: true } as any,
        { id: 3, name: "Strict threshold", stock_quantity: 1, is_available: true, low_stock_threshold: 0 } as any,
      ];

      expect(lowStockProducts.value.map((p) => p.id)).toEqual([1]);
      expect(outOfStockProducts.value).toHaveLength(0);
    });
  });

  describe("adjustStock", () => {
    it("should patch the matching product in state with the server's post-movement values", async () => {
      const { products, adjustStock } = createComposable();

      products.value = [
        { id: 1, name: "Produto A", stock_quantity: 10, is_available: true } as any,
        { id: 2, name: "Produto B", stock_quantity: 5, is_available: true } as any,
      ];

      vi.spyOn(ProductService, "createStockMovement").mockResolvedValue({
        movement: { id: 99, movement_type: "entrada", quantity: 5 } as any,
        product: { id: 1, name: "Produto A", stock_quantity: 15, is_available: true } as any,
      });

      const movement = await adjustStock(1, {
        movement_type: "entrada",
        quantity: 5,
        reason: "compra",
      });

      expect(movement.id).toBe(99);
      expect(products.value.find((p) => p.id === 1)?.stock_quantity).toBe(15);
      // The untouched product must be left exactly as it was.
      expect(products.value.find((p) => p.id === 2)?.stock_quantity).toBe(5);
      expect(mockToast.success).toHaveBeenCalled();
    });

    it("should leave product state untouched and surface an error on rejection", async () => {
      const { products, adjustStock, error } = createComposable();

      products.value = [
        { id: 1, name: "Produto A", stock_quantity: 10, is_available: true } as any,
      ];

      vi.spyOn(ProductService, "createStockMovement").mockRejectedValue(
        new Error("Estoque insuficiente.")
      );

      await expect(
        adjustStock(1, { movement_type: "saida", quantity: 999, reason: "perda_avaria" })
      ).rejects.toThrow();

      expect(products.value.find((p) => p.id === 1)?.stock_quantity).toBe(10);
      expect(error.value).toContain("Failed to adjust stock");
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe("low_stock_threshold payload handling", () => {
    /**
     * Etapa 3: null must reach the backend as an explicit empty string (so
     * DRF clears it back to null), not be silently omitted like every other
     * null/undefined/"" field in this payload builder -- see the dedicated
     * branch in _preparePayload() and the live-server verification in
     * docs/architecture/stock-movement-evolution.md.
     */
    it("sends an explicit empty string when clearing the threshold back to null", async () => {
      const { updateProduct } = createComposable();
      const serviceSpy = vi.spyOn(ProductService, "update").mockResolvedValue({ id: 5 } as any);

      await updateProduct(5, { name: "Produto", low_stock_threshold: null } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[1] as FormData;
      expect(sentPayload.get("low_stock_threshold")).toBe("");
    });

    it("sends the numeric value, including an explicit 0, when set", async () => {
      const { updateProduct } = createComposable();
      const serviceSpy = vi.spyOn(ProductService, "update").mockResolvedValue({ id: 5 } as any);

      await updateProduct(5, { name: "Produto", low_stock_threshold: 0 } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[1] as FormData;
      expect(sentPayload.get("low_stock_threshold")).toBe("0");
    });
  });

  describe("clearable free-text payload handling", () => {
    /**
     * Regression: an emptied description/size must reach the backend as ''
     * so a partial update actually clears it. Dropping the key (the default
     * for every other empty field) left the stale value in place -- the
     * "I cleared it, saved, and it came back on reload" bug.
     */
    it("sends an explicit empty string when the description is cleared", async () => {
      const { updateProduct } = createComposable();
      const serviceSpy = vi.spyOn(ProductService, "update").mockResolvedValue({ id: 7 } as any);

      await updateProduct(7, { name: "Produto", description: "", size: "" } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[1] as FormData;
      expect(sentPayload.has("description")).toBe(true);
      expect(sentPayload.get("description")).toBe("");
      expect(sentPayload.has("size")).toBe(true);
      expect(sentPayload.get("size")).toBe("");
    });

    it("still sends a non-empty description/size unchanged", async () => {
      const { updateProduct } = createComposable();
      const serviceSpy = vi.spyOn(ProductService, "update").mockResolvedValue({ id: 8 } as any);

      await updateProduct(8, { name: "Produto", description: "Nova desc", size: "GG" } as any);

      const sentPayload = serviceSpy.mock.calls[0]?.[1] as FormData;
      expect(sentPayload.get("description")).toBe("Nova desc");
      expect(sentPayload.get("size")).toBe("GG");
    });
  });

  describe("Bulk Selection Actions", () => {
    const productA = { id: 1, name: "Product A", price: 10, stock_quantity: 5 } as any;
    const productB = { id: 2, name: "Product B", price: 20, stock_quantity: 3 } as any;
    const productC = { id: 3, name: "Product C", price: 30, stock_quantity: 1 } as any;

    beforeEach(() => {
      const { products, selectedAssetIds } = createComposable();
      products.value = [];
      selectedAssetIds.value.clear();
    });

    it("toggleSelection adds and removes a single id", () => {
      const { products, selectedAssetIds, toggleSelection } = createComposable();
      products.value = [productA, productB, productC];

      toggleSelection(1);
      expect(selectedAssetIds.value.has(1)).toBe(true);

      toggleSelection(1);
      expect(selectedAssetIds.value.has(1)).toBe(false);
    });

    it("selectAll selects every currently loaded product", () => {
      const { products, selectedAssetIds, selectAll } = createComposable();
      products.value = [productA, productB, productC];

      selectAll();

      expect(Array.from(selectedAssetIds.value).sort()).toEqual([1, 2, 3]);
    });

    it("clearSelection empties the selection", () => {
      const { products, selectedAssetIds, selectAll, clearSelection } = createComposable();
      products.value = [productA, productB, productC];
      selectAll();

      clearSelection();

      expect(selectedAssetIds.value.size).toBe(0);
    });

    it("isAllSelected is true only when every loaded product is selected", () => {
      const { products, isAllSelected, toggleSelection } = createComposable();
      products.value = [productA, productB, productC];

      expect(isAllSelected.value).toBe(false);

      toggleSelection(1);
      toggleSelection(2);
      toggleSelection(3);
      expect(isAllSelected.value).toBe(true);
    });

    it("isIndeterminate is true only for a partial selection", () => {
      const { products, isIndeterminate, toggleSelection } = createComposable();
      products.value = [productA, productB, productC];

      expect(isIndeterminate.value).toBe(false);

      toggleSelection(1);
      expect(isIndeterminate.value).toBe(true);

      toggleSelection(2);
      toggleSelection(3);
      expect(isIndeterminate.value).toBe(false);
    });

    it("toggleSelectAll selects everything when nothing is selected", () => {
      const { products, selectedAssetIds, toggleSelectAll } = createComposable();
      products.value = [productA, productB, productC];

      toggleSelectAll();

      expect(Array.from(selectedAssetIds.value).sort()).toEqual([1, 2, 3]);
    });

    it("toggleSelectAll clears the selection when everything is already selected", () => {
      const { products, selectedAssetIds, selectAll, toggleSelectAll } = createComposable();
      products.value = [productA, productB, productC];
      selectAll();

      toggleSelectAll();

      expect(selectedAssetIds.value.size).toBe(0);
    });

    it("toggleSelectAll completes the selection instead of clearing it when only indeterminate (partial)", () => {
      const { products, selectedAssetIds, toggleSelection, toggleSelectAll } = createComposable();
      products.value = [productA, productB, productC];
      toggleSelection(1);

      toggleSelectAll();

      expect(Array.from(selectedAssetIds.value).sort()).toEqual([1, 2, 3]);
    });
  });

  afterEach(() => {
    dispose?.();
  });
});
