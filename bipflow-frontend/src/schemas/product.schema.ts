import { z } from "zod";

/**
 * ---------------------------------------------------------
 * 📦 1. DOMÍNIO DE CATEGORIAS
 * ---------------------------------------------------------
 */
export const CategorySchema = z.object({
  id: z.number(),
  name: z.string().min(1, "Category name is required"),
  slug: z.string().nullable().optional(),
  parent: z.number().nullable().optional(),
  parent_name: z.string().nullable().optional(),
});

/**
 * ---------------------------------------------------------
 * 🚀 2. DOMÍNIO DE PRODUTOS (CORE ASSETS)
 * ---------------------------------------------------------
 */

// Trava de Segurança NYC: 2MB em Bytes
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const REQUIRED_CATEGORY_MESSAGE = "Please select a classification";

const ProductGalleryImageSchema = z.union([
  z.string().url(),
  z
    .instanceof(File)
    .refine((file) => file.size <= MAX_FILE_SIZE, `Image too heavy. Max limit is 2MB.`)
    .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), "Only .jpg, .png and .webp formats are supported."),
]);

const ProductVariantImageSchema = z
  .union([
    z.string().url(),
    z
      .instanceof(File)
      .refine((file) => file.size <= MAX_FILE_SIZE, `Image too heavy. Max limit is 2MB.`)
      .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), "Only .jpg, .png and .webp formats are supported."),
    z.null(),
  ])
  .optional();

// Null means "inherit the product's base price" -- an empty/untouched input
// resolves to null, never to 0 (0.00 is a legitimate explicit price). Same
// shape as LowStockThresholdSchema above.
const VariantPriceSchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  z.coerce
    .number()
    .min(0, "Preço da variação não pode ser negativo")
    .nullable(),
);

const ProductVariantSchema = z.object({
  id: z.number().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Variant name is required")
    .max(80, "Variant name is too long"),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a valid hex color, like #111827")
    .transform((value) => value.toUpperCase()),
  price: VariantPriceSchema,
  stock_quantity: z.coerce
    .number()
    .int("Variant stock must be an integer")
    .nonnegative("Variant stock cannot be negative")
    .default(0),
  image: ProductVariantImageSchema,
  is_active: z.boolean().default(true),
  position: z.coerce.number().int().nonnegative().default(0),
});

const OptionalCategoryReferenceSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.union([
    z.coerce.number().int().positive(REQUIRED_CATEGORY_MESSAGE),
    CategorySchema,
    z.undefined(),
  ]),
);

const RequiredCategoryIdSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? 0 : value),
  z.coerce.number().int().positive(REQUIRED_CATEGORY_MESSAGE),
);

// Null means "use the dashboard's default threshold" -- distinct from
// stock_quantity, an empty/untouched input here must resolve to null, never
// to 0 (0 is a legitimate explicit choice: "only alert when truly zeroed").
const LowStockThresholdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce
    .number()
    .int("Limite deve ser um número inteiro")
    .nonnegative("Limite não pode ser negativo")
    .nullable(),
);

const OptionalPositiveDimensionSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce.number().positive("A dimensão deve ser maior que zero").nullable(),
);

const OptionalPositiveWeightSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce
    .number()
    .int("O peso deve ser informado em gramas inteiras")
    .positive("O peso deve ser maior que zero")
    .nullable(),
);

const productBase = {
  name: z
    .string()
    .min(3, "Name must be at least 3 characters")
    .max(100, "Name too long for registry"),

  description: z.string().nullable().optional(),

  sku: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 4, {
      message: "SKU must be at least 4 characters if provided",
    })
    .transform((val) => val?.toUpperCase() || undefined)
    .nullable(),

  // Coerção Inteligente: Garante que o input do form vire número real
  price: z.coerce.number().min(0, "Price cannot be negative").default(0),

  stock_quantity: z.coerce
    .number()
    .int("Stock must be an integer")
    .nonnegative("Stock cannot be negative")
    .default(0),

  low_stock_threshold: LowStockThresholdSchema,

  // Categoria de leitura: suporta ID cru do Django, objeto normalizado ou payload legado sem categoria.
  category: OptionalCategoryReferenceSchema,

  is_available: z.boolean().default(true),
  size: z.string().nullable().optional(),
  // Optional until the merchant has measured each item for national shipping.
  weight_grams: OptionalPositiveWeightSchema,
  length_cm: OptionalPositiveDimensionSchema,
  width_cm: OptionalPositiveDimensionSchema,
  height_cm: OptionalPositiveDimensionSchema,

  /**
   * 🛡️ ASSET MEDIA GUARD (2MB Limit)
   * Validação multimodal para URLs existentes e Novos Uploads.
   */
  image: z
    .any()
    .refine((file) => {
      if (!file || typeof file === "string") return true;
      return file instanceof File;
    }, "Invalid file format.")
    .refine((file) => {
      if (!(file instanceof File)) return true;
      return file.size <= MAX_FILE_SIZE;
    }, `Image too heavy. Max limit is 2MB.`)
    .refine((file) => {
      if (!(file instanceof File)) return true;
      return ACCEPTED_IMAGE_TYPES.includes(file.type);
    }, "Only .jpg, .png and .webp formats are supported.")
    .nullable()
    .optional(),

  images: z
    .array(ProductGalleryImageSchema)
    .max(3, "You can upload up to 3 images per product.")
    .optional()
    .default([]),

  variants: z.array(ProductVariantSchema).optional().default([]),
};

// Schema de Leitura (API Response)
export const ProductSchema = z.object({
  id: z.number().optional(),
  ...productBase,
  // Auto-generated by the backend on creation (Etapa 1 of the QR-code
  // stock-exit evolution), immutable, never part of the write-side
  // ProductFormSchema below -- distinct from `sku`, which stays manual.
  public_code: z.string().optional().default(''),
  category_name: z.string().optional(),
  slug: z.string().nullable().optional(),
  price: z.preprocess(
    (val) => parseFloat(val as string),
    z.number().nonnegative(),
  ),
  stock_quantity: z.preprocess(
    (val) => parseInt(val as string),
    z.number().nonnegative(),
  ),
  image_url: z.string().url().nullable().optional(),
  created_at: z.string().optional(), // mais flexível
  updated_at: z.string().optional(),
});

// Schema de Escrita (Formulário)
export const ProductFormSchema = z.object({
  ...productBase,
  category: RequiredCategoryIdSchema,
});

/**
 * ---------------------------------------------------------
 * 🛒 3. DOMÍNIO DE PEDIDOS (LEGACY INTEGRATION)
 * ---------------------------------------------------------
 */

export const OrderItemSchema = z.object({
  idItem: z.string().min(1, "Item ID is required"),
  quantidadeItem: z.number().positive("Quantity must be positive"),
  valorItem: z.number().positive("Value must be positive"),
});

export const CreateOrderSchema = z.object({
  numeroPedido: z
    .string()
    .min(1, "Order number is required")
    .regex(/^[a-zA-Z0-9\-]+$/, "Invalid characters in order number"),
  valorTotal: z.number().positive().finite(),
  dataCriacao: z.string().datetime(),
  items: z.array(OrderItemSchema).default([]),
});

/**
 * ---------------------------------------------------------
 * 🏷️ 4. EXPORTS DE TIPOS & FACTORIES
 * ---------------------------------------------------------
 */

export type Product = z.infer<typeof ProductSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
export type ProductFormData = z.infer<typeof ProductFormSchema>;
export type ProductFormDraft = Partial<Omit<ProductFormData, "category">> & {
  category?: ProductFormData["category"] | null;
};

export const createEmptyProduct = (): ProductFormDraft => ({
  name: "",
  price: 0,
  stock_quantity: 0,
  low_stock_threshold: null,
  category: undefined,
  is_available: true,
  sku: "",
  size: "",
  image: null,
  images: [],
  variants: [],
  description: "",
  weight_grams: null,
  length_cm: null,
  width_cm: null,
  height_cm: null,
});
