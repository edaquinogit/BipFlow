import secrets
import uuid
from decimal import Decimal
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError
from django.core.validators import (
    MaxValueValidator,
    MinValueValidator,
    RegexValidator,
    URLValidator,
)
from django.db import IntegrityError, models, transaction
from django.utils import timezone
from django.utils.text import slugify

from .crypto import decrypt_secret, encrypt_secret


def generate_bot_session_id() -> str:
    """Return an opaque public identifier for bot conversation continuity."""
    return uuid.uuid4().hex


# Etapa 1 of the QR-code stock-exit evolution (see
# docs/architecture/qrcode-stock-exit-evolution.md): Product.public_code is a
# system-generated identifier meant to be printed as a QR Code. When a product
# is created without a merchant-provided SKU, the SKU mirrors this same code.
PRODUCT_PUBLIC_CODE_ALPHABET = (
    "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O/1/I/L, easy to read aloud
)
PRODUCT_PUBLIC_CODE_LENGTH = 8
PRODUCT_PUBLIC_CODE_MAX_ATTEMPTS = 8


def generate_product_public_code() -> str:
    """Return a random public lookup code for QR-code scanning.

    Same alphabet as MFABackupCode._generate_plain_code(). Uniqueness is
    enforced per store by unique_product_public_code_per_store;
    Product._save_with_generated_public_code() retries on a collision rather
    than trusting a plain existence check, which can't be race-safe against a
    concurrent insert.
    """
    return "".join(
        secrets.choice(PRODUCT_PUBLIC_CODE_ALPHABET)
        for _ in range(PRODUCT_PUBLIC_CODE_LENGTH)
    )


def product_image_upload_to(instance: "Product", filename: str) -> str:
    """Scope a product's cover image path by its store (Etapa 4)."""
    return f"products/{instance.store_id}/{timezone.now():%Y/%m}/{filename}"


def product_gallery_image_upload_to(
    instance: "ProductGalleryImage", filename: str
) -> str:
    """Scope a product's gallery image path by its parent product's store (Etapa 4)."""
    return f"products/{instance.product.store_id}/{timezone.now():%Y/%m}/{filename}"


def product_variant_image_upload_to(instance: "ProductVariant", filename: str) -> str:
    """Scope a variant image path by its parent product's store."""
    return f"products/{instance.product.store_id}/variants/{timezone.now():%Y/%m}/{filename}"


def get_default_store_id() -> int:
    """Resolve the single-tenant default store's PK as a field default.

    Returns the PK (not the Store instance): Django's SQLite schema editor
    resolves FK field defaults through `get_db_prep_value()` when backfilling
    existing rows during a migration, which expects a raw value it can bind
    directly rather than a model instance to introspect.

    Defined ahead of Store's own class body further below so Category,
    Product, DeliveryRegion and SaleOrder can reference it without
    reordering the file: the name only needs to resolve once this module
    has finished loading, never at class-definition time.
    """
    return Store.get_default().id


class StorefrontDestination:
    """Closed set of safe storefront CTA destinations."""

    NONE = "none"
    PRODUCTS = "products"
    CATEGORY = "category"
    PRODUCT = "product"
    EXTERNAL_URL = "external_url"

    CHOICES = [
        (NONE, "Nenhuma acao"),
        (PRODUCTS, "Abrir vitrine"),
        (CATEGORY, "Abrir categoria"),
        (PRODUCT, "Abrir produto"),
        (EXTERNAL_URL, "Abrir link externo"),
    ]

    @classmethod
    def build_url(cls, store: "Store", destination_type: str, destination_value: str) -> str:
        normalized_type = destination_type or cls.NONE
        normalized_value = str(destination_value or "").strip()

        if normalized_type == cls.NONE:
            return ""

        if normalized_type == cls.PRODUCTS:
            return f"/l/{store.slug}/produtos"

        if normalized_type == cls.CATEGORY:
            category = Category.objects.filter(
                store=store,
                id=normalized_value,
            ).first()
            if category is None:
                return ""
            return f"/l/{store.slug}/produtos?category={category.id}"

        if normalized_type == cls.PRODUCT:
            product = Product.objects.filter(store=store, id=normalized_value).first()
            if product is None:
                return ""
            if product.slug:
                return f"/l/{store.slug}/produtos/{product.slug}"
            if product.public_code:
                return f"/l/{store.slug}/p/{product.public_code}"
            return ""

        if normalized_type == cls.EXTERNAL_URL:
            return normalized_value

        return ""


class Category(models.Model):
    """Product category model for organizational purposes."""

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="categories",
        default=get_default_store_id,
        help_text="Tenant that owns this category (Etapa 2 of the multi-tenant evolution).",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="children",
        null=True,
        blank=True,
        help_text="Optional parent category for one-level subcategory organization.",
    )
    name = models.CharField(max_length=100)
    slug = models.SlugField(blank=True, null=True)
    description = models.TextField(
        blank=True, null=True, help_text="Optional category description"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "slug"],
                condition=models.Q(parent__isnull=True),
                name="unique_top_level_category_slug_per_store",
            ),
            models.UniqueConstraint(
                fields=["store", "parent", "slug"],
                condition=models.Q(parent__isnull=False),
                name="unique_subcategory_slug_per_parent",
            ),
        ]

    def _validate_parent_relationship(self) -> None:
        if not self.parent_id:
            return

        if self.pk and self.parent_id == self.pk:
            raise ValidationError(
                {"parent": "Uma categoria nao pode ser subcategoria dela mesma."}
            )

        if self.parent.parent_id is not None:
            raise ValidationError(
                {"parent": "Subcategorias nao podem receber outras subcategorias."}
            )

        if self.store_id and self.parent.store_id != self.store_id:
            raise ValidationError(
                {"parent": "A categoria principal deve pertencer a mesma loja."}
            )

    def clean(self) -> None:
        super().clean()
        self._validate_parent_relationship()

    def save(self, *args, **kwargs) -> None:
        """
        Auto-generate slug from category name if not provided.

        Args:
            *args: Variable length argument list for parent save().
            **kwargs: Arbitrary keyword arguments for parent save().
        """
        self._validate_parent_relationship()

        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        """Return the category name as string representation."""
        if self.parent_id:
            return f"{self.parent.name} / {self.name}"

        return self.name


class Product(models.Model):
    """Product model representing items in the inventory system."""

    # Relationship
    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="products",
        default=get_default_store_id,
        help_text="Tenant that owns this product (Etapa 2 of the multi-tenant evolution).",
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="products",
        help_text="Product category (deletes protected)",
    )

    # Unique Identification (Essential for Barcode/Scanner)
    sku = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Unique product code (SKU/Barcode). Defaults to the QR public code when omitted.",
    )
    public_code = models.CharField(
        max_length=12,
        blank=True,
        default="",
        db_index=True,
        help_text=(
            "Auto-generated, immutable lookup code used by QR Code scans "
            "(PDV and public storefront deep links, see "
            "docs/architecture/qrcode-stock-exit-evolution.md). Also used "
            "as the default SKU when no SKU is provided."
        ),
    )
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=False, blank=True, null=True)

    # Details
    description = models.TextField(
        blank=True, help_text="Complete description for online storefront"
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)
    size = models.CharField(
        max_length=50, blank=True, null=True, help_text="E.g: S, M, L or 42, 44"
    )

    # Inventory
    stock_quantity = models.PositiveIntegerField(default=0)
    is_available = models.BooleanField(default=True)
    low_stock_threshold = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Per-product low-stock alert threshold (Etapa 3 of the "
            "stock-movement evolution). Null means \"use the dashboard's "
            'default threshold" -- this is a preference, not an audited '
            "quantity, so unlike stock_quantity it stays freely editable."
        ),
    )

    # Media
    image = models.ImageField(upload_to=product_image_upload_to, null=True, blank=True)

    # Audit (Current market standard)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "sku"], name="unique_product_sku_per_store"
            ),
            models.UniqueConstraint(
                fields=["store", "slug"], name="unique_product_slug_per_store"
            ),
            models.UniqueConstraint(
                fields=["store", "public_code"],
                name="unique_product_public_code_per_store",
            ),
        ]

    def save(self, *args, **kwargs) -> None:
        """
        Auto-generate slug, public_code/SKU and manage availability before saving.

        Generates a unique slug from product name with UUID suffix if not provided.
        Automatically updates is_available based on stock_quantity. When no
        SKU is supplied, it mirrors the generated public_code so labels,
        search and QR/PDV flows share the same human-facing code.

        Args:
            *args: Variable length argument list for parent save().
            **kwargs: Arbitrary keyword arguments for parent save().
        """
        if not self.slug:
            self.slug = slugify(self.name) + "-" + str(uuid.uuid4())[:8]

        # Auto-calculate availability based on stock
        self.is_available = self.stock_quantity > 0

        if not self.public_code:
            self._save_with_generated_public_code(*args, **kwargs)
            return

        if self._assign_sku_from_public_code_if_missing():
            kwargs = self._include_update_field(kwargs, "sku")

        super().save(*args, **kwargs)

    def _assign_sku_from_public_code_if_missing(self) -> bool:
        """Mirror public_code into sku when the merchant left SKU blank."""
        if self.sku or not self.public_code:
            return False

        self.sku = self.public_code
        return True

    def _include_update_field(self, kwargs: dict, field_name: str) -> dict:
        """Ensure auto-filled fields persist even when save(update_fields=...) is used."""
        update_fields = kwargs.get("update_fields")
        if update_fields is None:
            return kwargs

        return {**kwargs, "update_fields": set(update_fields) | {field_name}}

    def _save_with_generated_public_code(self, *args, **kwargs) -> None:
        """Assign a fresh public_code/SKU and retry on a rare collision.

        A plain "check then use" query isn't race-safe against a concurrent
        insert for the same store, so this instead lets
        unique_product_public_code_per_store reject the save and retries with
        a new random code. If SKU was auto-filled from that same candidate,
        unique_product_sku_per_store can also reject it when the candidate
        happens to match another product's manual SKU; that collision is also
        retryable. Other IntegrityErrors are re-raised immediately instead of
        being masked behind pointless retries.
        """
        auto_sku = not self.sku

        for attempt in range(PRODUCT_PUBLIC_CODE_MAX_ATTEMPTS):
            self.public_code = generate_product_public_code()
            if auto_sku:
                self.sku = self.public_code
                kwargs = self._include_update_field(kwargs, "sku")

            try:
                with transaction.atomic():
                    super().save(*args, **kwargs)
                return
            except IntegrityError as exc:
                is_last_attempt = attempt == PRODUCT_PUBLIC_CODE_MAX_ATTEMPTS - 1
                error_text = str(exc)
                is_retryable_code_collision = "public_code" in error_text
                is_retryable_auto_sku_collision = auto_sku and "sku" in error_text
                if (
                    not (is_retryable_code_collision or is_retryable_auto_sku_collision)
                    or is_last_attempt
                ):
                    raise

    def __str__(self) -> str:
        """Return product SKU and name as string representation."""
        return f"{self.sku} - {self.name}"

    def get_effective_price(self, variant: "ProductVariant | None" = None) -> Decimal:
        """Return the price a checkout/PDV line should charge for this product.

        A variant with its own `price` overrides the base price; a variant
        with `price=None` (the default) inherits `Product.price`. This is the
        single source of truth for that fallback -- callers must never
        re-implement ``variant.price or product.price`` themselves (0.00 is a
        real price, only ``None`` means "inherit"). See
        docs/architecture/product-variant-pricing.md.
        """
        if variant is not None and variant.price is not None:
            return variant.price
        return self.price

    @property
    def public_image_urls(self) -> list[str]:
        """Return all public-facing product image paths preserving display order."""
        urls: list[str] = []

        if self.image:
            urls.append(self.image.url)

        urls.extend(
            gallery_item.image.url
            for gallery_item in self.gallery_images.all()
            if gallery_item.image
        )

        return urls[:3]


class ProductGalleryImage(models.Model):
    """Additional product images used by the public detail gallery."""

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="gallery_images",
    )
    image = models.ImageField(upload_to=product_gallery_image_upload_to)
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self) -> str:
        """Return a compact identifier for admin/debug purposes."""
        return f"{self.product_id} - gallery image {self.position}"


class ProductVariant(models.Model):
    """Color variation of a product, optionally with its own image."""

    COLOR_HEX_VALIDATOR = RegexValidator(
        regex=r"^#[0-9A-Fa-f]{6}$",
        message="Informe uma cor hexadecimal no formato #RRGGBB.",
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    name = models.CharField(max_length=80)
    color_hex = models.CharField(max_length=7, validators=[COLOR_HEX_VALIDATOR])
    stock_quantity = models.PositiveIntegerField(default=0)
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
        help_text=(
            "Optional per-variant price override. NULL (the default) means "
            "this variant inherits Product.price -- semantically different "
            "from 0.00. Resolve the effective price via "
            "Product.get_effective_price(variant), never variant.price directly."
        ),
    )
    image = models.ImageField(
        upload_to=product_variant_image_upload_to, null=True, blank=True
    )
    is_active = models.BooleanField(default=True)
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["product", "name"],
                name="unique_product_variant_name_per_product",
            ),
            models.UniqueConstraint(
                fields=["product", "position"],
                name="unique_product_variant_position_per_product",
            ),
        ]

    def __str__(self) -> str:
        """Return the variant label for admin/debug purposes."""
        return f"{self.product_id} - {self.name}"


class DeliveryRegion(models.Model):
    """Configurable delivery fee by operating region."""

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="delivery_regions",
        default=get_default_store_id,
        help_text="Tenant that owns this delivery region (Etapa 2 of the multi-tenant evolution).",
    )
    name = models.CharField(max_length=120)
    city = models.CharField(max_length=120, blank=True)
    neighborhoods = models.TextField(
        blank=True, help_text="Optional comma-separated neighborhood hints"
    )
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "name"], name="unique_delivery_region_name_per_store"
            ),
        ]

    def __str__(self) -> str:
        """Return the region name for admin/debug purposes."""
        return self.name


class Store(models.Model):
    """Tenant root entity. Etapa 3 of the multi-tenant evolution: requests now
    resolve to a specific store (JWT claim for the dashboard, `X-Store-Slug`
    header for the public catalog) and every business queryset is filtered
    by it. See docs/architecture/multi-tenant-evolution.md.
    """

    DEFAULT_SLUG = "default"

    THEME_KEYS = ("primary", "accent", "background", "surface", "text", "muted")
    DEFAULT_THEME = {
        "primary": "#05050A",
        "accent": "#111827",
        "background": "#FAFAFA",
        "surface": "#FFFFFF",
        "text": "#05050A",
        "muted": "#6B7280",
    }

    # PDV receipt print-format presets (see docs/architecture/
    # pdv-camera-scanner-refinement.md's receipt/print-format follow-up):
    # the two dominant thermal receipt-roll widths in Brazilian retail, plus
    # a plain-sheet fallback for stores printing on a regular printer.
    RECEIPT_PAPER_FORMAT_58MM = "58mm"
    RECEIPT_PAPER_FORMAT_80MM = "80mm"
    RECEIPT_PAPER_FORMAT_A4 = "a4"
    RECEIPT_PAPER_FORMAT_CHOICES = [
        (RECEIPT_PAPER_FORMAT_58MM, "Bobina 58mm"),
        (RECEIPT_PAPER_FORMAT_80MM, "Bobina 80mm"),
        (RECEIPT_PAPER_FORMAT_A4, "Folha A4"),
    ]
    DEFAULT_RECEIPT_EXCHANGE_POLICY = (
        "Trocas e devoluções em até 7 dias mediante apresentação deste comprovante."
    )

    name = models.CharField(max_length=120)
    display_name = models.CharField(max_length=120, blank=True)
    slug = models.SlugField(unique=True)
    logo_url = models.URLField(max_length=500, blank=True)
    tagline = models.CharField(max_length=160, blank=True)
    whatsapp_phone = models.CharField(max_length=32, blank=True)
    theme = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    # Etapa PDV receipt refinement: store-level, editable per store (blank
    # means "don't show a policy line on the printed receipt at all") --
    # deliberately not a hardcoded "7 dias" string in the frontend template.
    receipt_exchange_policy = models.CharField(
        max_length=280, blank=True, default=DEFAULT_RECEIPT_EXCHANGE_POLICY
    )
    receipt_paper_format = models.CharField(
        max_length=10,
        choices=RECEIPT_PAPER_FORMAT_CHOICES,
        default=RECEIPT_PAPER_FORMAT_80MM,
    )
    # Nullable: data migrations run before any user exists in a fresh
    # database (seed_dashboard_roles runs after migrate), so a NOT NULL FK
    # would break `manage.py migrate` on first deploy. Etapa 4 (onboarding)
    # assigns a real owner when stores are created through the product flow.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="owned_stores",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        """Return the store name for admin/debug purposes."""
        return self.name

    @property
    def whatsapp_phone_digits(self) -> str:
        """Expose this store's normalized WhatsApp phone digits."""
        return StoreSettings.normalize_phone(self.whatsapp_phone)

    def get_configured_whatsapp_phone(self) -> str:
        """Return this store's WhatsApp phone, falling back to the environment default.

        Mirrors StoreSettings.get_configured_whatsapp_phone() but scoped to
        this specific tenant instead of the single global singleton, for
        CheckoutWhatsAppView once it resolves a request-specific store.
        """
        if self.whatsapp_phone_digits:
            return self.whatsapp_phone_digits

        return StoreSettings.normalize_phone(
            getattr(settings, "WHATSAPP_ORDER_PHONE", "")
        )

    @classmethod
    def normalize_theme(cls, theme: dict | None) -> dict[str, str]:
        """Return the allowlisted storefront theme with safe defaults."""
        if not isinstance(theme, dict):
            theme = {}

        normalized_theme: dict[str, str] = {}
        for key in cls.THEME_KEYS:
            value = str(theme.get(key, "") or "").strip()
            if not ProductVariant.COLOR_HEX_VALIDATOR.regex.match(value):
                value = cls.DEFAULT_THEME[key]
            normalized_theme[key] = value.upper() if len(value) == 7 else value

        return normalized_theme

    @classmethod
    def get_default(cls) -> "Store":
        """Return the single-tenant store, creating it when needed."""
        store, _created = cls.objects.get_or_create(
            slug=cls.DEFAULT_SLUG,
            defaults={
                "name": "Loja Principal",
                "tagline": "",
            },
        )
        return store

    @classmethod
    def create_for_owner(cls, *, name: str, owner) -> "Store":
        """Create a new store with a unique slug and an owner membership (Etapa 4).

        Shared by registration (a user's first store) and the dashboard's
        "new store" action (an existing user adding another one).
        """
        base_slug = slugify(name) or "loja"
        slug = base_slug
        suffix = 1
        while cls.objects.filter(slug=slug).exists():
            suffix += 1
            slug = f"{base_slug}-{suffix}"

        store = cls.objects.create(name=name, slug=slug, owner=owner)
        StoreMembership.objects.create(
            store=store, user=owner, role=StoreMembership.ROLE_OWNER
        )
        return store


class StoreMembership(models.Model):
    """Links a user to a store with a store-scoped role.

    Etapa 1 only creates this table and backfills it from the existing
    global RBAC groups; permissions still read global groups until Etapa 3.
    """

    ROLE_OWNER = "owner"
    ROLE_MANAGER = "manager"
    ROLE_VIEWER = "viewer"
    ROLE_CHOICES = [
        (ROLE_OWNER, "Owner"),
        (ROLE_MANAGER, "Manager"),
        (ROLE_VIEWER, "Viewer"),
    ]

    store = models.ForeignKey(
        Store, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="store_memberships",
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default=ROLE_VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("store", "user")
        ordering = ["store_id", "role"]

    def __str__(self) -> str:
        """Return a compact membership identifier for admin/debug purposes."""
        return f"{self.user_id} @ {self.store_id} ({self.role})"


class LabelSettings(models.Model):
    """Tenant-owned printable product-label sheet configuration."""

    PAGE_FORMAT_A4 = "a4"
    PAGE_FORMAT_CHOICES = [
        (PAGE_FORMAT_A4, "A4"),
    ]

    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name="label_settings",
    )
    page_format = models.CharField(
        max_length=8,
        choices=PAGE_FORMAT_CHOICES,
        default=PAGE_FORMAT_A4,
    )
    columns = models.PositiveSmallIntegerField(
        default=2,
        validators=[MinValueValidator(1), MaxValueValidator(6)],
    )
    rows = models.PositiveSmallIntegerField(
        default=5,
        validators=[MinValueValidator(1), MaxValueValidator(12)],
    )
    margin_mm = models.PositiveSmallIntegerField(
        default=10,
        validators=[MinValueValidator(0), MaxValueValidator(30)],
    )
    cell_padding_mm = models.PositiveSmallIntegerField(
        default=4,
        validators=[MinValueValidator(0), MaxValueValidator(20)],
    )
    qr_size_mm = models.PositiveSmallIntegerField(
        default=26,
        validators=[MinValueValidator(12), MaxValueValidator(80)],
    )
    show_price = models.BooleanField(default=True)
    show_size = models.BooleanField(default=True)
    show_public_code = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Label settings"
        verbose_name_plural = "Label settings"

    @property
    def labels_per_page(self) -> int:
        return self.columns * self.rows

    @classmethod
    def get_for_store(cls, store: Store) -> "LabelSettings":
        settings_instance, _created = cls.objects.get_or_create(store=store)
        return settings_instance

    def __str__(self) -> str:
        return f"Label settings for {self.store_id}"


class StorefrontAppearance(models.Model):
    """Controlled storefront personalization scoped to one store.

    Deliberately separate from Store.theme (primary/accent/background/
    surface/text/muted, already wired end to end through the theme engine):
    this model only adds what Store doesn't already cover -- an optional
    secondary color plus hero, typography, layout preset and motion/decoration choices.
    Every non-color field is a closed choice set, never a free CSS/JS value,
    so a merchant can't inject unsafe styling into every other tenant's
    shared frontend build.
    """

    CARD_STYLE_CLEAN = "clean"
    CARD_STYLE_BORDERED = "bordered"
    CARD_STYLE_ELEVATED = "elevated"
    CARD_STYLE_CHOICES = [
        (CARD_STYLE_CLEAN, "Clean"),
        (CARD_STYLE_BORDERED, "Bordered"),
        (CARD_STYLE_ELEVATED, "Elevated"),
    ]

    RADIUS_STYLE_MINIMAL = "minimal"
    RADIUS_STYLE_ROUNDED = "rounded"
    RADIUS_STYLE_SOFT = "soft"
    RADIUS_STYLE_CHOICES = [
        (RADIUS_STYLE_MINIMAL, "Minimal"),
        (RADIUS_STYLE_ROUNDED, "Rounded"),
        (RADIUS_STYLE_SOFT, "Soft"),
    ]

    DENSITY_COMPACT = "compact"
    DENSITY_COMFORTABLE = "comfortable"
    DENSITY_CHOICES = [
        (DENSITY_COMPACT, "Compact"),
        (DENSITY_COMFORTABLE, "Comfortable"),
    ]

    FONT_PRESET_MODERN = "modern"
    FONT_PRESET_EDITORIAL = "editorial"
    FONT_PRESET_CLASSIC = "classic"
    FONT_PRESET_CHOICES = [
        (FONT_PRESET_MODERN, "Modern"),
        (FONT_PRESET_EDITORIAL, "Editorial"),
        (FONT_PRESET_CLASSIC, "Classic"),
    ]

    MOTION_INTENSITY_SUBTLE = "subtle"
    MOTION_INTENSITY_STANDARD = "standard"
    MOTION_INTENSITY_CHOICES = [
        (MOTION_INTENSITY_SUBTLE, "Subtle"),
        (MOTION_INTENSITY_STANDARD, "Standard"),
    ]

    DECORATION_STYLE_NONE = "none"
    DECORATION_STYLE_CIRCLES = "circles"
    DECORATION_STYLE_SOFT_SHAPES = "soft-shapes"
    DECORATION_STYLE_GEOMETRIC = "geometric"
    DECORATION_STYLE_CHOICES = [
        (DECORATION_STYLE_NONE, "None"),
        (DECORATION_STYLE_CIRCLES, "Circles"),
        (DECORATION_STYLE_SOFT_SHAPES, "Soft shapes"),
        (DECORATION_STYLE_GEOMETRIC, "Geometric"),
    ]

    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name="storefront_appearance",
    )

    # Optional -- the theme engine falls back to Store.theme's accent color
    # when blank (see useStoreTheme.ts's --store-secondary-base).
    secondary_color = models.CharField(max_length=7, blank=True)

    hero_enabled = models.BooleanField(default=False)
    hero_image_desktop = models.URLField(max_length=500, blank=True)
    hero_image_mobile = models.URLField(max_length=500, blank=True)
    hero_alt_text = models.CharField(max_length=160, blank=True)
    hero_title = models.CharField(max_length=120, blank=True)
    hero_subtitle = models.CharField(max_length=200, blank=True)
    hero_cta_text = models.CharField(max_length=40, blank=True)
    hero_destination_type = models.CharField(
        max_length=16,
        choices=StorefrontDestination.CHOICES,
        default=StorefrontDestination.NONE,
    )
    hero_destination_value = models.CharField(max_length=500, blank=True)
    hero_cta_url = models.CharField(max_length=500, blank=True)
    favicon_url = models.URLField(max_length=500, blank=True)

    card_style = models.CharField(
        max_length=16, choices=CARD_STYLE_CHOICES, default=CARD_STYLE_CLEAN
    )
    radius_style = models.CharField(
        max_length=16, choices=RADIUS_STYLE_CHOICES, default=RADIUS_STYLE_ROUNDED
    )
    density = models.CharField(
        max_length=16, choices=DENSITY_CHOICES, default=DENSITY_COMFORTABLE
    )
    font_preset = models.CharField(
        max_length=16, choices=FONT_PRESET_CHOICES, default=FONT_PRESET_MODERN
    )

    motion_enabled = models.BooleanField(default=True)
    motion_intensity = models.CharField(
        max_length=16,
        choices=MOTION_INTENSITY_CHOICES,
        default=MOTION_INTENSITY_STANDARD,
    )

    decoration_enabled = models.BooleanField(default=False)
    decoration_style = models.CharField(
        max_length=16,
        choices=DECORATION_STYLE_CHOICES,
        default=DECORATION_STYLE_NONE,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Storefront appearance"
        verbose_name_plural = "Storefront appearance"

    @classmethod
    def normalize_secondary_color(cls, value: str | None) -> str:
        """Return `value` if it's a valid hex color, else '' (falls back to accent)."""
        normalized_value = str(value or "").strip()
        if not ProductVariant.COLOR_HEX_VALIDATOR.regex.match(normalized_value):
            return ""
        return normalized_value.upper() if len(normalized_value) == 7 else normalized_value

    @classmethod
    def get_for_store(cls, store: Store) -> "StorefrontAppearance":
        appearance, _created = cls.objects.get_or_create(store=store)
        return appearance

    def __str__(self) -> str:
        return f"Storefront appearance for {self.store_id}"


class StorefrontBanner(models.Model):
    """Promotional storefront banner scoped to one store."""

    store = models.ForeignKey(
        Store,
        on_delete=models.CASCADE,
        related_name="storefront_banners",
    )
    image_url = models.URLField(max_length=500)
    alt_text = models.CharField(max_length=160, blank=True)
    title = models.CharField(max_length=120, blank=True)
    subtitle = models.CharField(max_length=200, blank=True)
    cta_text = models.CharField(max_length=40, blank=True)
    destination_type = models.CharField(
        max_length=16,
        choices=StorefrontDestination.CHOICES,
        default=StorefrontDestination.NONE,
    )
    destination_value = models.CharField(max_length=500, blank=True)
    button_url = models.CharField(max_length=500, blank=True)
    position = models.PositiveIntegerField(default=0, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["store", "position"]),
            models.Index(fields=["store", "is_active", "starts_at", "ends_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(starts_at__isnull=True)
                    | models.Q(ends_at__isnull=True)
                    | models.Q(starts_at__lte=models.F("ends_at"))
                ),
                name="storefront_banner_valid_schedule",
            ),
        ]

    @property
    def status(self) -> str:
        now = timezone.now()
        if not self.is_active:
            return "inactive"
        if self.starts_at and self.starts_at > now:
            return "scheduled"
        if self.ends_at and self.ends_at < now:
            return "expired"
        return "active"

    @classmethod
    def public_for_store(cls, store: Store):
        now = timezone.now()
        return (
            cls.objects.filter(store=store, is_active=True)
            .filter(models.Q(starts_at__isnull=True) | models.Q(starts_at__lte=now))
            .filter(models.Q(ends_at__isnull=True) | models.Q(ends_at__gte=now))
            .order_by("position", "id")
        )

    def refresh_button_url(self) -> None:
        self.button_url = StorefrontDestination.build_url(
            self.store,
            self.destination_type,
            self.destination_value,
        )

    def save(self, *args, **kwargs):
        self.refresh_button_url()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        label = self.title or self.alt_text or f"Banner {self.id or ''}".strip()
        return f"{label} @ {self.store_id}"


class CustomerProfile(models.Model):
    """Storefront customer identity scoped to a single store.

    Keeps customer onboarding separate from dashboard memberships: a customer
    can have an authenticated account for ordering and order history without
    gaining dashboard access to catalog/settings resources.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="customer_profiles",
    )
    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="customer_profiles",
    )
    full_name = models.CharField(max_length=160, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    # Default checkout address, added so the public checkout form no longer
    # has to ask for it on every order (see
    # docs/architecture/customer-profile-checkout-evolution.md). No separate
    # email field: the account's own `user.email` (already mandatory/unique
    # at registration) already serves as the checkout contact email, so
    # asking for it a second time here would just duplicate that. Deliberately
    # a single flat address, not an address book -- matches how the rest of
    # this codebase favors the simplest model that satisfies the ask.
    address = models.CharField(max_length=255, blank=True)
    neighborhood = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=255, blank=True)
    delivery_region = models.ForeignKey(
        DeliveryRegion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_profiles",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "store")
        ordering = ["store_id", "user_id"]

    def __str__(self) -> str:
        """Return a compact customer profile identifier for admin/debug purposes."""
        return f"customer:{self.user_id} @ {self.store_id}"


class StoreSettings(models.Model):
    """Singleton operational settings controlled from the dashboard."""

    singleton_key = models.PositiveSmallIntegerField(
        default=1, unique=True, editable=False
    )
    whatsapp_phone = models.CharField(
        max_length=32,
        blank=True,
        help_text="WhatsApp number that receives public storefront orders.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Store settings"
        verbose_name_plural = "Store settings"

    def __str__(self) -> str:
        """Return a readable identifier for admin/debug purposes."""
        return "Store settings"

    @staticmethod
    def normalize_phone(phone: str) -> str:
        """Return only phone digits for WhatsApp deep links."""
        return "".join(character for character in phone if character.isdigit())

    @property
    def whatsapp_phone_digits(self) -> str:
        """Expose the normalized phone currently stored in the dashboard."""
        return self.normalize_phone(self.whatsapp_phone)

    @classmethod
    def get_solo(cls) -> "StoreSettings":
        """Return the single dashboard settings row, creating it when needed."""
        settings_instance, _created = cls.objects.get_or_create(singleton_key=1)
        return settings_instance

    @classmethod
    def get_configured_whatsapp_phone(cls) -> str:
        """Return dashboard WhatsApp phone, falling back to the environment value."""
        settings_instance = cls.objects.filter(singleton_key=1).first()
        dashboard_phone = (
            settings_instance.whatsapp_phone_digits if settings_instance else ""
        )

        if dashboard_phone:
            return dashboard_phone

        return cls.normalize_phone(getattr(settings, "WHATSAPP_ORDER_PHONE", ""))


# Only http/https links may be stored for merchant-provided URLs. Django's
# default URLField also allows ftp/ftps; javascript:/data:/file: are already
# rejected by URLValidator, but pinning the scheme list here is defense in
# depth for anything that writes the field outside the DRF serializer (Django
# admin, data migrations, shell).
merchant_url_validator = URLValidator(schemes=["http", "https"])

# Brazilian federative units. MerchantProfile.state is a closed set, never
# free text -- keeps the address usable for display and, later, for fiscal.
BRAZILIAN_UF_CODES = (
    "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI "
    "RJ RN RS RO RR SC SP SE TO"
).split()


def normalize_merchant_digits(value: str | None) -> str:
    """Return only the decimal digits of a merchant-provided identifier."""
    return "".join(character for character in str(value or "") if character.isdigit())


def _is_valid_merchant_cpf(digits: str) -> bool:
    """Standard mod-11 CPF check-digit validation."""
    if len(digits) != 11 or digits == digits[0] * 11:
        return False

    for length in (9, 10):
        total = sum(
            int(digits[index]) * ((length + 1) - index) for index in range(length)
        )
        check = (total * 10) % 11 % 10
        if check != int(digits[length]):
            return False
    return True


_MERCHANT_CNPJ_WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
_MERCHANT_CNPJ_WEIGHTS_SECOND = [6, *_MERCHANT_CNPJ_WEIGHTS_FIRST]


def _is_valid_merchant_cnpj(digits: str) -> bool:
    """Standard mod-11 CNPJ check-digit validation."""
    if len(digits) != 14 or digits == digits[0] * 14:
        return False

    for weights, length in (
        (_MERCHANT_CNPJ_WEIGHTS_FIRST, 12),
        (_MERCHANT_CNPJ_WEIGHTS_SECOND, 13),
    ):
        total = sum(int(digits[index]) * weights[index] for index in range(length))
        remainder = total % 11
        check = 0 if remainder < 2 else 11 - remainder
        if check != int(digits[length]):
            return False
    return True


def clean_merchant_tax_id(value: str | None) -> str:
    """Normalize and validate a Brazilian CPF/CNPJ for MerchantProfile."""
    digits = normalize_merchant_digits(value)
    if not digits:
        return ""

    if len(digits) == 11:
        if not _is_valid_merchant_cpf(digits):
            raise ValidationError("CPF invalido.")
    elif len(digits) == 14:
        if not _is_valid_merchant_cnpj(digits):
            raise ValidationError("CNPJ invalido.")
    else:
        raise ValidationError("Informe um CPF (11 digitos) ou CNPJ (14 digitos).")
    return digits


def clean_merchant_contact_phone(value: str | None) -> str:
    """Normalize and validate the merchant commercial phone number."""
    digits = normalize_merchant_digits(value)
    if not digits:
        return ""
    if len(digits) < 10 or len(digits) > 13:
        raise ValidationError("Informe o telefone com DDD. Ex.: 71 3333-4444.")
    return digits


def clean_merchant_postal_code(value: str | None) -> str:
    """Normalize and validate a Brazilian CEP for MerchantProfile."""
    digits = normalize_merchant_digits(value)
    if not digits:
        return ""
    if len(digits) != 8:
        raise ValidationError("O CEP deve ter 8 digitos.")
    return digits


def clean_merchant_country(value: str | None) -> str:
    """Normalize and validate the two-letter country code."""
    normalized = (value or "").strip().upper()
    if not normalized:
        return "BR"
    if len(normalized) != 2 or not normalized.isalpha():
        raise ValidationError("Use o codigo de pais com 2 letras. Ex.: BR.")
    return normalized


# Host fragments a merchant-provided social link is expected to point at. A
# link whose host clearly belongs to a different network is almost always a
# paste error (or worse) -- rejected with a clear message rather than shown
# as that network's icon on the storefront. website_url is intentionally
# unconstrained (any http/https host).
MERCHANT_SOCIAL_URL_HOST_HINTS = {
    "instagram_url": ("instagram.com", "instagr.am"),
    "facebook_url": ("facebook.com", "fb.com", "fb.me"),
    "tiktok_url": ("tiktok.com",),
    "youtube_url": ("youtube.com", "youtu.be"),
}


def normalize_merchant_public_url(value: str | None) -> str:
    """Trim optional public URL fields without changing their content."""
    return (value or "").strip()


def validate_merchant_social_url_host(field_name: str, value: str | None) -> None:
    """Validate social URL host compatibility for network-specific fields."""
    normalized = normalize_merchant_public_url(value)
    if not normalized:
        return

    expected_hosts = MERCHANT_SOCIAL_URL_HOST_HINTS.get(field_name)
    if not expected_hosts:
        return

    host = urlparse(normalized).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if not any(
        host == candidate or host.endswith(f".{candidate}")
        for candidate in expected_hosts
    ):
        raise ValidationError(f"Este link nao parece ser do {expected_hosts[0]}.")


def clean_merchant_public_url(field_name: str, value: str | None) -> str:
    """Normalize and validate an optional public MerchantProfile URL."""
    normalized = normalize_merchant_public_url(value)
    if not normalized:
        return ""

    try:
        merchant_url_validator(normalized)
    except ValidationError as error:
        raise ValidationError("Informe um link valido comecando com https://.") from error

    validate_merchant_social_url_host(field_name, normalized)
    return normalized


class MerchantProfile(models.Model):
    """Commercial identity, contact, address and social links for one Store.

    COMMERCE P1 (see docs/architecture/commerce-merchant-profile.md). A
    per-store settings cluster following the same OneToOne + get_for_store()
    pattern as LabelSettings / StorefrontAppearance -- deliberately not extra
    columns on Store, which is already the multi-tenant root and only carries
    what the storefront theme engine needs.

    Every field is optional. A Store created before this model existed keeps
    working with an all-blank profile (get_for_store() creates it lazily),
    and onboarding is never blocked on it -- `is_complete` is a computed hint,
    not a gate.

    Nothing fiscal lives here (tax_regime, inscricao estadual, provider,
    environment, certificate) -- that is Commerce P4's StoreFiscalProfile.
    `tax_id` is a plain cadastral field, stored digits-only, with a
    length/checksum sanity check, not full fiscal validation.

    WhatsApp is intentionally absent: the checkout handoff reads
    Store.whatsapp_phone via Store.get_configured_whatsapp_phone() and that
    stays the single source of truth, edited on the existing "WhatsApp"
    settings tab. Duplicating it here would re-fragment a field the
    multi-tenant evolution already consolidated onto Store.
    """

    UF_CHOICES = [(code, code) for code in BRAZILIAN_UF_CODES]

    # Fields safe to echo on the public storefront (see
    # PublicStorefrontAppearanceSerializer). Everything else -- legal_name,
    # tax_id, contact_email, contact_phone, street/number/complement/
    # district/postal_code -- is dashboard-only.
    PUBLIC_FIELDS = (
        "trade_name",
        "city",
        "state",
        "website_url",
        "instagram_url",
        "facebook_url",
        "tiktok_url",
        "youtube_url",
    )

    SOCIAL_URL_FIELDS = (
        "website_url",
        "instagram_url",
        "facebook_url",
        "tiktok_url",
        "youtube_url",
    )

    store = models.OneToOneField(
        Store,
        on_delete=models.CASCADE,
        related_name="merchant_profile",
    )

    # --- Commercial identity ---
    legal_name = models.CharField(
        max_length=160, blank=True, help_text="Razao social"
    )
    trade_name = models.CharField(
        max_length=160, blank=True, help_text="Nome fantasia"
    )
    tax_id = models.CharField(
        max_length=14,
        blank=True,
        help_text="CPF (11 digitos) ou CNPJ (14). Armazenado somente com digitos.",
    )

    # --- Contact ---
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(
        max_length=13,
        blank=True,
        help_text="Telefone comercial, somente digitos (DDI+DDD+numero).",
    )

    # --- Address ---
    postal_code = models.CharField(
        max_length=8, blank=True, help_text="CEP, somente digitos"
    )
    street = models.CharField(max_length=160, blank=True)
    number = models.CharField(max_length=20, blank=True)
    complement = models.CharField(max_length=80, blank=True)
    district = models.CharField(max_length=80, blank=True, help_text="Bairro")
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(
        max_length=2, blank=True, choices=UF_CHOICES, help_text="UF"
    )
    country = models.CharField(max_length=2, default="BR")

    # --- Links / social ---
    website_url = models.URLField(
        max_length=300, blank=True, validators=[merchant_url_validator]
    )
    instagram_url = models.URLField(
        max_length=300, blank=True, validators=[merchant_url_validator]
    )
    facebook_url = models.URLField(
        max_length=300, blank=True, validators=[merchant_url_validator]
    )
    tiktok_url = models.URLField(
        max_length=300, blank=True, validators=[merchant_url_validator]
    )
    youtube_url = models.URLField(
        max_length=300, blank=True, validators=[merchant_url_validator]
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Merchant profile"
        verbose_name_plural = "Merchant profiles"

    def __str__(self) -> str:
        """Return a compact identifier for admin/debug purposes."""
        return f"Merchant profile for {self.store_id}"

    @staticmethod
    def normalize_digits(value: str | None) -> str:
        """Return only the decimal digits of `value` (CEP/CPF/CNPJ/phone)."""
        return normalize_merchant_digits(value)

    def _normalize_cleanable_fields(self, exclude: set[str] | None = None) -> None:
        excluded = exclude or set()
        if "tax_id" not in excluded:
            self.tax_id = normalize_merchant_digits(self.tax_id)
        if "contact_phone" not in excluded:
            self.contact_phone = normalize_merchant_digits(self.contact_phone)
        if "postal_code" not in excluded:
            self.postal_code = normalize_merchant_digits(self.postal_code)
        if "country" not in excluded:
            self.country = (self.country or "").strip().upper() or "BR"
        for field_name in self.SOCIAL_URL_FIELDS:
            if field_name not in excluded:
                setattr(
                    self,
                    field_name,
                    normalize_merchant_public_url(getattr(self, field_name)),
                )

    def clean_fields(self, exclude=None) -> None:
        """Normalize masks before model field validators check max_length."""
        self._normalize_cleanable_fields(set(exclude or []))
        super().clean_fields(exclude=exclude)

    def clean(self) -> None:
        """Apply MerchantProfile invariants for ModelForm/admin validation."""
        super().clean()
        self._normalize_cleanable_fields()

        errors = {}
        field_cleaners = {
            "tax_id": clean_merchant_tax_id,
            "contact_phone": clean_merchant_contact_phone,
            "postal_code": clean_merchant_postal_code,
            "country": clean_merchant_country,
        }
        for field_name, cleaner in field_cleaners.items():
            try:
                setattr(self, field_name, cleaner(getattr(self, field_name)))
            except ValidationError as error:
                errors[field_name] = error.messages

        for field_name in self.SOCIAL_URL_FIELDS:
            try:
                setattr(
                    self,
                    field_name,
                    clean_merchant_public_url(field_name, getattr(self, field_name)),
                )
            except ValidationError as error:
                errors[field_name] = error.messages

        if errors:
            raise ValidationError(errors)

    @classmethod
    def get_for_store(cls, store: "Store") -> "MerchantProfile":
        """Return this store's profile, creating an empty one on first access."""
        profile, _created = cls.objects.get_or_create(store=store)
        return profile

    @property
    def has_complete_address(self) -> bool:
        """Whether every field a shipping label / fiscal address needs is filled."""
        return all(
            [
                self.postal_code,
                self.street,
                self.number,
                self.district,
                self.city,
                self.state,
            ]
        )

    @property
    def is_complete(self) -> bool:
        """Computed onboarding hint -- never persisted, never a hard gate."""
        return all(
            [
                self.legal_name or self.trade_name,
                self.tax_id,
                self.contact_email,
                self.contact_phone,
                self.has_complete_address,
            ]
        )


class BotConversation(models.Model):
    """Conversation state for the public rule-based bot."""

    CHANNEL_WEB = "web"
    CHANNEL_WHATSAPP = "whatsapp"
    CHANNEL_CHOICES = [
        (CHANNEL_WEB, "Web"),
        (CHANNEL_WHATSAPP, "WhatsApp"),
    ]

    STATUS_OPEN = "open"
    STATUS_WAITING_CUSTOMER = "waiting_customer"
    STATUS_WAITING_HUMAN = "waiting_human"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_WAITING_CUSTOMER, "Waiting customer"),
        (STATUS_WAITING_HUMAN, "Waiting human"),
        (STATUS_CLOSED, "Closed"),
    ]

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="bot_conversations",
        default=get_default_store_id,
        help_text="Tenant this conversation belongs to.",
    )
    session_id = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        default=generate_bot_session_id,
        help_text="Public opaque identifier used by clients to continue the conversation.",
    )
    channel = models.CharField(
        max_length=16, choices=CHANNEL_CHOICES, default=CHANNEL_WEB
    )
    customer_phone = models.CharField(max_length=32, blank=True)
    status = models.CharField(
        max_length=24, choices=STATUS_CHOICES, default=STATUS_OPEN
    )
    last_intent = models.CharField(max_length=32, blank=True)
    sale_order = models.ForeignKey(
        "SaleOrder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bot_conversations",
        help_text="The order this conversation converted into, if any.",
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["channel", "status"]),
            models.Index(fields=["last_intent"]),
        ]

    def __str__(self) -> str:
        """Return a compact conversation identifier."""
        return f"{self.channel}:{self.session_id}"


class BotMessage(models.Model):
    """Persisted message exchanged inside a bot conversation."""

    ROLE_USER = "user"
    ROLE_BOT = "bot"
    ROLE_CHOICES = [
        (ROLE_USER, "User"),
        (ROLE_BOT, "Bot"),
    ]

    conversation = models.ForeignKey(
        BotConversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    content = models.TextField()
    intent = models.CharField(max_length=32, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["conversation", "created_at"]),
            models.Index(fields=["role"]),
        ]

    def __str__(self) -> str:
        """Return a compact message summary."""
        return f"{self.role} message in {self.conversation_id}"


class SaleOrder(models.Model):
    """Persisted checkout record used by the management dashboard."""

    STATUS_PREPARED = "prepared"
    STATUS_SENT = "sent"
    STATUS_DELIVERED = "delivered"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PREPARED, "Prepared"),
        (STATUS_SENT, "Sent"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    DELIVERY_CHOICES = [
        ("delivery", "Delivery"),
        ("pickup", "Pickup"),
    ]

    PAYMENT_CHOICES = [
        ("pix", "Pix"),
        ("card", "Card"),
        ("cash", "Cash"),
    ]

    # Etapa 3 of the QR-code stock-exit evolution (see
    # docs/architecture/qrcode-stock-exit-evolution.md): distinguishes the
    # existing e-commerce/WhatsApp checkout from the new PDV (physical store,
    # scanned QR Code). Default is CHANNEL_VIRTUAL so every order created
    # before this field existed keeps reading as what it always was.
    CHANNEL_VIRTUAL = "virtual"
    CHANNEL_LOJA_FISICA = "loja_fisica"
    CHANNEL_CHOICES = [
        (CHANNEL_VIRTUAL, "Virtual"),
        (CHANNEL_LOJA_FISICA, "Loja física"),
    ]

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="orders",
        default=get_default_store_id,
        help_text="Tenant that received this order (Etapa 2 of the multi-tenant evolution).",
    )
    order_reference = models.CharField(max_length=32, unique=True, db_index=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PREPARED
    )
    channel = models.CharField(
        max_length=16, choices=CHANNEL_CHOICES, default=CHANNEL_VIRTUAL
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_orders",
        help_text=(
            "Etapa R3 of the QR-code stock-exit refinement: the dashboard "
            "operator who rang up this sale, when there is one -- always "
            "set for a PDV sale, always null for a public/WhatsApp "
            "checkout, which has no authenticated staff involved."
        ),
    )

    customer_profile = models.ForeignKey(
        "CustomerProfile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
        help_text=(
            "Set when the order was placed by an authenticated storefront "
            "customer (see docs/architecture/customer-profile-checkout-"
            "evolution.md); always null for pre-existing orders and for PDV "
            "sales, which have no customer account involved."
        ),
    )
    idempotency_key = models.CharField(max_length=128, blank=True, default="")
    idempotency_payload_hash = models.CharField(max_length=64, blank=True, default="")
    customer_name = models.CharField(max_length=255)
    customer_phone = models.CharField(max_length=32)
    customer_email = models.EmailField(blank=True)
    delivery_method = models.CharField(max_length=16, choices=DELIVERY_CHOICES)
    payment_method = models.CharField(max_length=16, choices=PAYMENT_CHOICES)
    address = models.CharField(max_length=255, blank=True)
    neighborhood = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=255, blank=True)
    delivery_region = models.ForeignKey(
        DeliveryRegion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    delivery_region_name = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)

    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    message = models.TextField(blank=True)
    whatsapp_url = models.URLField(max_length=2048, blank=True)

    # Etapa 1 of the pedidos/NF/envio evolution (see
    # docs/architecture/pedidos-nf-envio-evolution.md): manual shipping --
    # carrier name + tracking code typed in by the operator, no freight API.
    # blank=True on all of them: orders already sitting in "sent" from before
    # this field existed stay valid without a backfill.
    carrier_name = models.CharField(max_length=120, blank=True)
    tracking_code = models.CharField(max_length=64, blank=True)
    tracking_url = models.URLField(max_length=512, blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["store", "created_at"]),
            models.Index(fields=["store", "status", "created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["store", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_sale_order_idempotency_per_store",
            ),
        ]

    def __str__(self) -> str:
        """Return a readable order identifier for admin/debug purposes."""
        return self.order_reference


class LoginAttempt(models.Model):
    """Audit trail of login attempts, success and failure (Fase 2 of the auth-security plan).

    Feeds the conditional CAPTCHA gate (`recent_failure_count`) and gives an
    admin visibility into credential-stuffing patterns. Retention is the
    operator's responsibility -- nothing here prunes old rows automatically,
    so a periodic cleanup job is needed before this grows unbounded under
    sustained attack traffic.
    """

    FAILURE_INVALID_CREDENTIALS = "invalid_credentials"
    FAILURE_THROTTLED = "throttled"
    FAILURE_CAPTCHA_REQUIRED = "captcha_required"
    FAILURE_MFA_REQUIRED = "mfa_required"
    FAILURE_MFA_INVALID = "mfa_invalid"
    FAILURE_CHOICES = [
        (FAILURE_INVALID_CREDENTIALS, "Invalid credentials"),
        (FAILURE_THROTTLED, "Throttled"),
        (FAILURE_CAPTCHA_REQUIRED, "Captcha required or invalid"),
        (FAILURE_MFA_REQUIRED, "MFA challenge issued"),
        (FAILURE_MFA_INVALID, "MFA code invalid"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="login_attempts",
        help_text="Resolved user, when the submitted identifier matched one. Null for unknown emails.",
    )
    identifier = models.CharField(
        max_length=255,
        help_text="Normalized (lowercased) submitted username/email.",
    )
    ip_address = models.GenericIPAddressField()
    user_agent = models.CharField(max_length=512, blank=True)
    succeeded = models.BooleanField(default=False)
    failure_reason = models.CharField(
        max_length=32, choices=FAILURE_CHOICES, blank=True
    )
    store_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["identifier", "created_at"]),
            models.Index(fields=["ip_address", "created_at"]),
        ]

    def __str__(self) -> str:
        """Return a compact, human-readable summary for admin/debug purposes."""
        outcome = "ok" if self.succeeded else (self.failure_reason or "failed")
        return f"{self.identifier} @ {self.created_at:%Y-%m-%d %H:%M} ({outcome})"

    @classmethod
    def record(
        cls,
        *,
        identifier: str,
        ip_address: str,
        user_agent: str = "",
        succeeded: bool = False,
        failure_reason: str = "",
        user=None,
        store_id: int | None = None,
    ) -> "LoginAttempt":
        return cls.objects.create(
            user=user,
            identifier=(identifier or "").strip().lower()[:255],
            ip_address=ip_address,
            user_agent=(user_agent or "")[:512],
            succeeded=succeeded,
            failure_reason=failure_reason,
            store_id=store_id,
        )

    @classmethod
    def recent_failure_count(cls, identifier: str, *, within_minutes: int = 15) -> int:
        """Count recent consecutive-looking failures, used to gate the CAPTCHA challenge."""
        normalized = (identifier or "").strip().lower()
        if not normalized:
            return 0

        since = timezone.now() - timezone.timedelta(minutes=within_minutes)
        return cls.objects.filter(
            identifier=normalized,
            succeeded=False,
            created_at__gte=since,
        ).count()


class TOTPDevice(models.Model):
    """A user's TOTP secret for MFA (Fase 3.1 of the auth-security plan).

    One per user. The secret is encrypted at rest (see crypto.py) since
    whoever holds it can generate valid codes indefinitely -- unlike a
    password, there's no hash-only storage option for a shared secret that
    both sides must reproduce the same codes from.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="totp_device",
    )
    encrypted_secret = models.BinaryField()
    confirmed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        """Return a compact identifier for admin/debug purposes."""
        state = "confirmed" if self.confirmed else "pending"
        return f"TOTP device for {self.user_id} ({state})"

    def get_secret(self) -> str:
        return decrypt_secret(bytes(self.encrypted_secret))

    def set_secret(self, raw_secret: str) -> None:
        self.encrypted_secret = encrypt_secret(raw_secret)


class MFABackupCode(models.Model):
    """Single-use recovery code for when the user's TOTP device is unavailable.

    Stored as a hash via Django's own password hasher -- the same trusted
    primitive already used for account passwords -- never in plaintext.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mfa_backup_codes",
    )
    code_hash = models.CharField(max_length=255)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["user", "used_at"])]

    def __str__(self) -> str:
        """Return a compact identifier for admin/debug purposes."""
        return (
            f"Backup code for {self.user_id} ({'used' if self.used_at else 'unused'})"
        )

    @staticmethod
    def _generate_plain_code() -> str:
        """Return a human-typeable single-use code, e.g. 'AB3K-9XQ2'."""
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I, easy to read aloud
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        return f"{raw[:4]}-{raw[4:]}"

    @classmethod
    def generate_for_user(cls, user, count: int = 8) -> list[str]:
        """Replace any existing codes with `count` fresh ones, returning the plaintext once."""
        cls.objects.filter(user=user).delete()
        plain_codes = [cls._generate_plain_code() for _ in range(count)]
        cls.objects.bulk_create(
            [cls(user=user, code_hash=make_password(code)) for code in plain_codes]
        )
        return plain_codes

    @classmethod
    def consume(cls, user, submitted_code: str) -> bool:
        """Check `submitted_code` against the user's unused codes, consuming it if it matches."""
        normalized = submitted_code.strip().upper()
        if not normalized:
            return False

        for backup_code in cls.objects.filter(user=user, used_at__isnull=True):
            if check_password(normalized, backup_code.code_hash):
                backup_code.used_at = timezone.now()
                backup_code.save(update_fields=["used_at"])
                return True

        return False


class SaleOrderItem(models.Model):
    """Snapshot of a product line at checkout time."""

    order = models.ForeignKey(SaleOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    product_name = models.CharField(max_length=255)
    sku = models.CharField(max_length=50, blank=True)
    variant_name = models.CharField(max_length=80, blank=True)
    variant_color_hex = models.CharField(max_length=7, blank=True)
    variant_image_url = models.URLField(blank=True)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        """Return a compact line summary."""
        return f"{self.product_name} x{self.quantity}"


class StockMovement(models.Model):
    """Append-only audit trail for every `Product.stock_quantity` change.

    `Product.stock_quantity` stays the fast, denormalized "current value"
    column; this table is the ledger that explains every change to it
    (Etapa 1 of the stock-movement evolution, see
    docs/architecture/stock-movement-evolution.md). `quantity` is always
    positive -- direction comes from `movement_type`, never from sign.
    """

    TYPE_ENTRADA = "entrada"
    TYPE_SAIDA = "saida"
    TYPE_CHOICES = [
        (TYPE_ENTRADA, "Entrada"),
        (TYPE_SAIDA, "Saída"),
    ]

    SOURCE_MANUAL = "manual"
    SOURCE_VENDA = "venda"
    SOURCE_PDV = "pdv"
    SOURCE_CHOICES = [
        (SOURCE_MANUAL, "Manual"),
        (SOURCE_VENDA, "Venda"),
        (SOURCE_PDV, "PDV"),
    ]

    REASON_COMPRA = "compra"
    REASON_DEVOLUCAO = "devolucao"
    REASON_PERDA_AVARIA = "perda_avaria"
    REASON_AJUSTE_INVENTARIO = "ajuste_inventario"
    REASON_ENTRADA_INICIAL = "entrada_inicial"
    REASON_VENDA = "venda"
    REASON_VENDA_CANCELADA = "venda_cancelada"
    REASON_OUTRO = "outro"
    REASON_CHOICES = [
        (REASON_COMPRA, "Compra"),
        (REASON_DEVOLUCAO, "Devolução"),
        (REASON_PERDA_AVARIA, "Perda/Avaria"),
        (REASON_AJUSTE_INVENTARIO, "Ajuste de inventário"),
        (REASON_ENTRADA_INICIAL, "Entrada inicial"),
        (REASON_VENDA, "Venda"),
        (REASON_VENDA_CANCELADA, "Venda cancelada"),
        (REASON_OUTRO, "Outro"),
    ]

    # System-generated reasons a human can never pick from the manual
    # entrada/saida form -- only `apply_stock_movement()`, the checkout flow
    # and `apply_order_cancellation()` (Etapa R2 of the QR-code stock-exit
    # refinement, see bipdelivery/api/stock.py) are allowed to write these.
    SYSTEM_ONLY_REASONS = {REASON_ENTRADA_INICIAL, REASON_VENDA, REASON_VENDA_CANCELADA}

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="stock_movements",
        default=get_default_store_id,
        help_text="Tenant that owns this movement.",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    movement_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    quantity = models.PositiveIntegerField(
        help_text="Always positive; direction comes from movement_type."
    )
    previous_stock = models.PositiveIntegerField()
    new_stock = models.PositiveIntegerField()
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    source = models.CharField(
        max_length=10, choices=SOURCE_CHOICES, default=SOURCE_MANUAL
    )
    sale_order = models.ForeignKey(
        SaleOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["store", "product", "created_at"]),
            models.Index(fields=["store", "variant", "created_at"]),
            models.Index(fields=["store", "created_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(new_stock__gte=0),
                name="stock_movement_new_stock_non_negative",
            ),
        ]

    def __str__(self) -> str:
        """Return a compact movement summary."""
        variant_suffix = f" / {self.variant.name}" if self.variant_id else ""
        return f"{self.get_movement_type_display()} {self.quantity} - {self.product.name}{variant_suffix}"


class CustomerFeedback(models.Model):
    """Problem report / suggestion submitted from the public storefront.

    Deliberately minimal: no PII beyond an optional free-text contact, no
    sensitive request internals (headers, tokens, cookies). `correlation_id`
    is the same `X-Request-ID` GlobalExceptionMiddleware already stamps on
    every response -- the connective tissue between a human's "não consegui
    calcular o frete" and the matching server log line, without building a
    second tracing mechanism.
    """

    TYPE_PROBLEM = "problem"
    TYPE_PURCHASE_DIFFICULTY = "purchase_difficulty"
    TYPE_SHIPPING = "shipping"
    TYPE_CHECKOUT = "checkout"
    TYPE_PRODUCT = "product"
    TYPE_SUGGESTION = "suggestion"
    TYPE_OTHER = "other"
    TYPE_CHOICES = [
        (TYPE_PROBLEM, "Problema"),
        (TYPE_PURCHASE_DIFFICULTY, "Dificuldade na compra"),
        (TYPE_SHIPPING, "Entrega/Frete"),
        (TYPE_CHECKOUT, "Checkout"),
        (TYPE_PRODUCT, "Produto"),
        (TYPE_SUGGESTION, "Sugestao"),
        (TYPE_OTHER, "Outro"),
    ]

    STATUS_NEW = "new"
    STATUS_REVIEWING = "reviewing"
    STATUS_RESOLVED = "resolved"
    STATUS_IGNORED = "ignored"
    STATUS_CHOICES = [
        (STATUS_NEW, "Novo"),
        (STATUS_REVIEWING, "Em analise"),
        (STATUS_RESOLVED, "Resolvido"),
        (STATUS_IGNORED, "Ignorado"),
    ]

    store = models.ForeignKey(
        "Store",
        on_delete=models.CASCADE,
        related_name="customer_feedback",
        default=get_default_store_id,
        help_text="Tenant this feedback was submitted to.",
    )
    customer_profile = models.ForeignKey(
        CustomerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback",
        help_text="Resolved automatically from the authenticated session, when there is one.",
    )
    feedback_type = models.CharField(max_length=24, choices=TYPE_CHOICES)
    message = models.TextField(max_length=2000)
    contact = models.CharField(
        max_length=160,
        blank=True,
        help_text="Optional WhatsApp/e-mail the customer left for a reply.",
    )
    page_path = models.CharField(
        max_length=512,
        blank=True,
        help_text="Storefront route the report was opened from, not a full URL.",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback",
    )
    order = models.ForeignKey(
        SaleOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="feedback",
    )
    correlation_id = models.CharField(
        max_length=64,
        blank=True,
        help_text="X-Request-ID of the failed request this feedback is about, when known.",
    )
    user_agent = models.CharField(max_length=512, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["store", "status", "created_at"]),
            models.Index(fields=["store", "feedback_type", "created_at"]),
        ]

    def __str__(self) -> str:
        """Return a compact feedback identifier for admin/debug purposes."""
        return f"{self.get_feedback_type_display()} @ {self.store_id} ({self.status})"
