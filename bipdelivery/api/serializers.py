import re
import logging
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.utils.text import slugify
from PIL import Image, UnidentifiedImageError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import (
    BotConversation,
    BotMessage,
    Category,
    clean_merchant_contact_phone,
    clean_merchant_country,
    clean_merchant_postal_code,
    clean_merchant_public_url,
    clean_merchant_tax_id,
    CustomerFeedback,
    CustomerProfile,
    DeliveryRegion,
    LabelSettings,
    MerchantProfile,
    Product,
    ProductGalleryImage,
    ProductVariant,
    SaleOrder,
    SaleOrderItem,
    StockMovement,
    Store,
    StorefrontBanner,
    StorefrontDestination,
    StorefrontAppearance,
    StoreMembership,
    StoreSettings,
    TOTPDevice,
)
from .permissions import (
    get_user_roles,
    has_dashboard_read_access,
    has_dashboard_write_access,
)
from .stock import sync_product_stock_from_variants

User = get_user_model()
logger = logging.getLogger(__name__)

STOREFRONT_MEDIA_PATH_RE = re.compile(
    r"(?:^|/)stores/(?P<store_id>\d+)/storefront(?:/|$)"
)
SAFE_IMAGE_UPLOAD_TYPES = {
    "image/jpeg": {"extensions": {"jpg", "jpeg"}, "format": "JPEG"},
    "image/jpg": {"extensions": {"jpg", "jpeg"}, "format": "JPEG"},
    "image/png": {"extensions": {"png"}, "format": "PNG"},
    "image/webp": {"extensions": {"webp"}, "format": "WEBP"},
}
PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024


def detect_image_upload_format(uploaded_file) -> str:
    try:
        uploaded_file.seek(0)
        with Image.open(uploaded_file) as image:
            detected_format = image.format or ""
            image.verify()
        return detected_format
    except (UnidentifiedImageError, OSError) as error:
        raise serializers.ValidationError(
            {"file": "Arquivo de imagem invalido."}
        ) from error
    finally:
        uploaded_file.seek(0)


def validate_safe_image_upload(uploaded_file, *, max_bytes: int) -> tuple[str, str]:
    content_type = str(getattr(uploaded_file, "content_type", "") or "").lower()
    content_type = content_type.split(";", 1)[0].strip()

    if content_type not in SAFE_IMAGE_UPLOAD_TYPES:
        raise serializers.ValidationError(
            {"file": "Envie uma imagem PNG, JPG, JPEG ou WEBP."}
        )

    extension = Path(uploaded_file.name or "").suffix.lower().lstrip(".")
    expected_extensions = SAFE_IMAGE_UPLOAD_TYPES[content_type]["extensions"]
    if extension not in expected_extensions:
        raise serializers.ValidationError(
            {"file": "A extensao do arquivo nao corresponde ao tipo da imagem."}
        )

    if uploaded_file.size > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        raise serializers.ValidationError(
            {"file": f"A imagem deve ter no maximo {max_mb} MB."}
        )

    detected_format = detect_image_upload_format(uploaded_file)
    expected_format = SAFE_IMAGE_UPLOAD_TYPES[content_type]["format"]
    if detected_format != expected_format:
        raise serializers.ValidationError(
            {"file": "O conteudo do arquivo nao corresponde ao tipo informado."}
        )

    return content_type, "jpg" if extension == "jpeg" else extension


def validate_storefront_media_url_ownership(
    value: str,
    *,
    store: Store | None,
    field_name: str,
) -> str:
    """Reject reusing uploaded storefront media that belongs to another store."""

    normalized_value = str(value or "").strip()
    if not normalized_value or store is None:
        return normalized_value

    parsed_path = unquote(urlparse(normalized_value).path or normalized_value)
    match = STOREFRONT_MEDIA_PATH_RE.search(parsed_path)
    if match and int(match.group("store_id")) != store.id:
        raise serializers.ValidationError("Esta midia nao pertence a loja atual.")

    return normalized_value


class CurrentUserSerializer(serializers.ModelSerializer):
    """Authenticated user summary for dashboard personalization."""

    display_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    can_access_dashboard = serializers.SerializerMethodField()
    can_manage_catalog = serializers.SerializerMethodField()
    can_manage_orders = serializers.SerializerMethodField()
    mfa_enabled = serializers.SerializerMethodField()
    profile_kinds = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "display_name",
            "is_staff",
            "is_superuser",
            "roles",
            "can_access_dashboard",
            "can_manage_catalog",
            "can_manage_orders",
            "mfa_enabled",
            "profile_kinds",
        ]
        read_only_fields = fields

    def get_display_name(self, user: User) -> str:
        """Return the best available human-friendly user name."""
        full_name = user.get_full_name().strip()
        if full_name:
            return full_name

        if user.email:
            return user.email.split("@", 1)[0]

        return user.username

    def get_roles(self, user: User) -> list[str]:
        """Return dashboard role labels assigned through Django groups/staff flags."""
        return get_user_roles(user)

    def get_can_access_dashboard(self, user: User) -> bool:
        """Expose whether the user can read private dashboard resources."""
        return has_dashboard_read_access(user)

    def get_can_manage_catalog(self, user: User) -> bool:
        """Expose whether the user can mutate catalog and freight resources."""
        return has_dashboard_write_access(user)

    def get_can_manage_orders(self, user: User) -> bool:
        """Expose whether the user can mutate order status/shipping data.

        Same underlying gate as can_manage_catalog today -- there is no
        per-feature RBAC yet (decisao arquitetural 7, fase 1 of
        docs/architecture/pedidos-nf-envio-evolution.md). A stricter,
        separately-assignable role is deferred to when the truly sensitive
        fiscal actions (NF-e emission/cancellation) ship.
        """
        return has_dashboard_write_access(user)

    def get_mfa_enabled(self, user: User) -> bool:
        """Expose whether a confirmed TOTP device is active for this account."""
        return TOTPDevice.objects.filter(user=user, confirmed=True).exists()

    def get_profile_kinds(self, user: User) -> list[str]:
        """Return a coarse-grained profile map for frontend routing decisions."""
        kinds: list[str] = []

        if user.is_staff or user.is_superuser:
            kinds.append("platform_admin")

        if user.store_memberships.filter(role=StoreMembership.ROLE_OWNER).exists():
            kinds.append("dashboard_owner")
        elif user.store_memberships.exists():
            kinds.append("dashboard_member")

        if user.customer_profiles.exists():
            kinds.append("customer")

        return kinds


class StoreScopedTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Embed the user's store in the JWT (Etapa 3 of the multi-tenant evolution).

    Resolved once at login from StoreMembership and carried by the refresh
    token, so it also reaches every access token minted via refresh without
    extra wiring. Users without a membership (none exist outside the Etapa 1
    backfill yet) simply get no claim; request-side resolution then falls
    back to the single default store, identical to today's behaviour.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        membership = (
            StoreMembership.objects.filter(user=user).select_related("store").first()
        )

        if membership is not None:
            token["store_id"] = membership.store.id
            return token

        # No dashboard membership: fall back to a storefront customer
        # profile (see docs/architecture/customer-profile-checkout-
        # evolution.md) so a customer's JWT also carries a store_id claim,
        # not just staff/owner logins.
        customer_profile = (
            CustomerProfile.objects.filter(user=user).select_related("store").first()
        )
        if customer_profile is not None:
            token["store_id"] = customer_profile.store.id

        return token


class CategorySerializer(serializers.ModelSerializer):
    """Serializer for Category model with optional one-level subcategories."""

    parent = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), required=False, allow_null=True
    )
    parent_name = serializers.SerializerMethodField()
    product_count = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "parent",
            "parent_name",
            "product_count",
            "children_count",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "parent_name",
            "product_count",
            "children_count",
            "created_at",
        ]

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

        store = self._get_context_store()
        if store is None:
            return

        parent_queryset = Category.objects.filter(store=store, parent__isnull=True)
        instance_id = getattr(self.instance, "pk", None)
        if instance_id is not None:
            parent_queryset = parent_queryset.exclude(id=instance_id)

        self.fields["parent"].queryset = parent_queryset

    def _get_context_store(self) -> Store | None:
        store = self.context.get("store")
        if store is not None:
            return store

        if self.instance is not None and hasattr(self.instance, "store"):
            return self.instance.store

        view = self.context.get("view")
        if view is not None and hasattr(view, "get_request_store"):
            return view.get_request_store()

        return None

    def get_parent_name(self, category: Category) -> str | None:
        return category.parent.name if category.parent_id else None

    def get_product_count(self, category: Category) -> int:
        product_count = getattr(category, "product_count", None)
        if product_count is not None:
            return product_count

        return category.products.count()

    def get_children_count(self, category: Category) -> int:
        children_count = getattr(category, "children_count", None)
        if children_count is not None:
            return children_count

        return category.children.count()

    def validate_parent(self, parent: Category | None) -> Category | None:
        if parent is None:
            return None

        store = self._get_context_store()
        if store is not None and parent.store_id != store.id:
            raise serializers.ValidationError(
                "A categoria principal deve pertencer a mesma loja."
            )

        if self.instance is not None and parent.id == self.instance.id:
            raise serializers.ValidationError(
                "Uma categoria nao pode ser subcategoria dela mesma."
            )

        if parent.parent_id is not None:
            raise serializers.ValidationError(
                "Subcategorias nao podem receber outras subcategorias."
            )

        return parent

    def validate(self, attrs):
        attrs = super().validate(attrs)

        store = self._get_context_store()
        if store is None:
            return attrs

        name = attrs.get("name", getattr(self.instance, "name", ""))
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        raw_slug = attrs.get("slug", getattr(self.instance, "slug", "") or "")
        normalized_slug = slugify(raw_slug or name)

        if not normalized_slug:
            return attrs

        duplicate_queryset = Category.objects.filter(
            store=store, parent=parent, slug=normalized_slug
        )
        if self.instance is not None:
            duplicate_queryset = duplicate_queryset.exclude(id=self.instance.id)

        if duplicate_queryset.exists():
            raise serializers.ValidationError(
                {
                    "name": "Ja existe uma categoria com este nome neste nivel."
                }
            )

        return attrs


class ProductVariantSerializer(serializers.ModelSerializer):
    """Read-only product color variant payload."""

    image = serializers.SerializerMethodField()
    # `price` is the raw override ("69.90" or null); `effective_price` is the
    # value a checkout line would actually charge, with the Product.price
    # fallback already applied -- so the frontend never re-derives the rule.
    effective_price = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "name",
            "color_hex",
            "price",
            "effective_price",
            "stock_quantity",
            "image",
            "is_active",
            "position",
        ]

    def get_effective_price(self, instance: ProductVariant) -> str:
        if instance.price is not None:
            return f"{Decimal(instance.price):.2f}"
        # ProductSerializer.to_representation puts the parent product's base
        # price here, so a variant that inherits it needs no per-row query.
        # `instance.product` is only touched on the (rare) path where this
        # serializer runs without that parent -- kept as a correctness net.
        base_price = self.context.get("variant_base_price")
        if base_price is None:
            base_price = instance.product.price
        return f"{Decimal(base_price):.2f}"

    def get_image(self, instance: ProductVariant) -> str | None:
        if not instance.image:
            return None

        request = self.context.get("request")
        if request is not None:
            return request.build_absolute_uri(instance.image.url)

        base_url = getattr(settings, "BASE_URL", "http://127.0.0.1:8000")
        return urljoin(base_url, instance.image.url)


class ProductSerializer(serializers.ModelSerializer):
    """
    Serializer for Product model with nested category name.

    Handles conversion of ImageField to absolute URI for API responses.
    Includes read-only computed fields for category relationships.
    """

    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.none())
    category_name = serializers.ReadOnlyField(source="category.name")
    category_parent = serializers.SerializerMethodField()
    category_parent_name = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    uploaded_images = serializers.ListField(
        child=serializers.ImageField(),
        write_only=True,
        required=False,
        max_length=3,
    )
    existing_images = serializers.ListField(
        child=serializers.CharField(),
        write_only=True,
        required=False,
        max_length=3,
    )
    variants = ProductVariantSerializer(many=True, read_only=True)
    variants_payload = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Product
        fields = [
            "id",
            "sku",
            "public_code",
            "name",
            "slug",
            "description",
            "price",
            "size",
            "stock_quantity",
            "low_stock_threshold",
            "is_available",
            "image",
            "images",
            "uploaded_images",
            "existing_images",
            "variants",
            "variants_payload",
            "category",
            "category_name",
            "category_parent",
            "category_parent_name",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "public_code",
            "slug",
            "created_at",
            "category_name",
            "category_parent",
            "category_parent_name",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request_store = self._get_request_store()
        if request_store is not None:
            self.fields["category"].queryset = Category.objects.filter(
                store=request_store
            )

    def _get_request_store(self) -> Store | None:
        context_store = self.context.get("store") or self.context.get(
            "request_store"
        )
        if isinstance(context_store, Store):
            return context_store

        view = self.context.get("view")
        if view is not None and hasattr(view, "get_request_store"):
            return view.get_request_store()

        if isinstance(self.instance, Product) and self.instance.store_id:
            return self.instance.store

        return None

    def validate_category(self, category: Category) -> Category:
        request_store = self._get_request_store()
        if request_store is not None and category.store_id != request_store.id:
            raise serializers.ValidationError(
                "Categoria nao pertence a loja atual."
            )
        return category

    def _validate_product_image_upload(self, uploaded_file, *, field_name: str) -> None:
        if not hasattr(uploaded_file, "content_type"):
            return

        try:
            validate_safe_image_upload(
                uploaded_file,
                max_bytes=PRODUCT_IMAGE_MAX_BYTES,
            )
        except serializers.ValidationError as error:
            detail = error.detail
            request_store = self._get_request_store()
            logger.warning(
                "product_upload.rejected",
                extra={
                    "event": "product_upload.rejected",
                    "store_id": request_store.id if request_store else None,
                    "store_slug": request_store.slug if request_store else None,
                    "field_name": field_name,
                    "upload_filename": Path(
                        getattr(uploaded_file, "name", "") or ""
                    ).name,
                    "content_type": getattr(uploaded_file, "content_type", ""),
                    "size": getattr(uploaded_file, "size", None),
                    "reason": str(detail.get("file", detail))
                    if isinstance(detail, dict)
                    else str(detail),
                },
            )
            if isinstance(detail, dict) and "file" in detail:
                raise serializers.ValidationError(
                    {field_name: detail["file"]}
                ) from error
            raise

    def validate(self, attrs):
        attrs = super().validate(attrs)

        request_images = self._resolve_ordered_request_images(self.instance)

        if request_images is not None:
            total_images = len(request_images)
            for image_file in request_images:
                self._validate_product_image_upload(
                    image_file,
                    field_name="uploaded_images",
                )
        else:
            uploaded_images = attrs.get("uploaded_images", [])
            existing_images = attrs.get("existing_images", [])
            direct_image = attrs.get("image")
            total_images = (
                len(uploaded_images) + len(existing_images) + (1 if direct_image else 0)
            )
            if direct_image:
                self._validate_product_image_upload(
                    direct_image,
                    field_name="image",
                )
            for image_file in uploaded_images:
                self._validate_product_image_upload(
                    image_file,
                    field_name="uploaded_images",
                )

        if total_images > 3:
            raise serializers.ValidationError(
                {"uploaded_images": "Cada produto pode ter no maximo 3 imagens."}
            )

        if "variants_payload" in attrs:
            attrs["variants_payload"] = self._validate_variants_payload(
                attrs["variants_payload"]
            )

        return attrs

    def _validate_variants_payload(self, payload) -> list[dict]:
        if payload in (None, ""):
            return []

        if not isinstance(payload, list):
            raise serializers.ValidationError(
                {"variants_payload": "Variantes devem ser enviadas como lista."}
            )

        normalized_variants = []
        seen_names: set[str] = set()
        seen_positions: set[int] = set()

        for index, raw_variant in enumerate(payload):
            if not isinstance(raw_variant, dict):
                raise serializers.ValidationError(
                    {"variants_payload": "Cada variante deve ser um objeto."}
                )

            name = str(raw_variant.get("name", "")).strip()
            color_hex = str(raw_variant.get("color_hex", "")).strip().upper()
            position = raw_variant.get("position", index)
            raw_stock_quantity = raw_variant.get("stock_quantity", serializers.empty)

            try:
                position = int(position)
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    {"variants_payload": "A posicao da variante deve ser numerica."}
                )

            if raw_stock_quantity is serializers.empty:
                stock_quantity = None
            else:
                try:
                    stock_quantity = int(raw_stock_quantity or 0)
                except (TypeError, ValueError):
                    raise serializers.ValidationError(
                        {
                            "variants_payload": "A quantidade da variante deve ser numerica."
                        }
                    )

            if not name:
                raise serializers.ValidationError(
                    {"variants_payload": "Informe o nome da variante."}
                )

            if not re.fullmatch(r"#[0-9A-F]{6}", color_hex):
                raise serializers.ValidationError(
                    {"variants_payload": "Informe cores no formato #RRGGBB."}
                )

            if position < 0:
                raise serializers.ValidationError(
                    {"variants_payload": "A posicao da variante nao pode ser negativa."}
                )

            if stock_quantity is not None and stock_quantity < 0:
                raise serializers.ValidationError(
                    {
                        "variants_payload": "A quantidade da variante nao pode ser negativa."
                    }
                )

            # A missing "price" key means "don't touch the stored override"
            # (legacy clients never send it); an explicit null/"" clears it.
            # Kept distinct via the serializers.empty sentinel, mirroring how
            # "image" and "stock_quantity" already tolerate omission below.
            if "price" in raw_variant:
                price = self._normalize_variant_price(raw_variant["price"])
            else:
                price = serializers.empty

            normalized_name = name.casefold()
            if normalized_name in seen_names:
                raise serializers.ValidationError(
                    {
                        "variants_payload": "Nomes de variantes nao podem se repetir no produto."
                    }
                )
            seen_names.add(normalized_name)

            if position in seen_positions:
                raise serializers.ValidationError(
                    {
                        "variants_payload": "Posicoes de variantes nao podem se repetir no produto."
                    }
                )
            seen_positions.add(position)

            variant_id = raw_variant.get("id")
            if variant_id in ("", None):
                variant_id = None
            else:
                try:
                    variant_id = int(variant_id)
                except (TypeError, ValueError):
                    raise serializers.ValidationError(
                        {"variants_payload": "ID de variante invalido."}
                    )

            image_upload_index = raw_variant.get("image_upload_index")
            if image_upload_index in ("", None):
                image_upload_index = None
            else:
                try:
                    image_upload_index = int(image_upload_index)
                except (TypeError, ValueError):
                    raise serializers.ValidationError(
                        {"variants_payload": "Indice de imagem de variante invalido."}
                    )
                uploaded_variant_image = self._get_variant_upload(image_upload_index)
                if uploaded_variant_image is not None:
                    self._validate_product_image_upload(
                        uploaded_variant_image,
                        field_name=f"variant_images[{image_upload_index}]",
                    )

            raw_is_active = raw_variant.get("is_active", True)
            if isinstance(raw_is_active, bool):
                is_active = raw_is_active
            elif isinstance(raw_is_active, str):
                is_active = raw_is_active.strip().lower() not in {
                    "",
                    "0",
                    "false",
                    "no",
                    "off",
                }
            else:
                is_active = bool(raw_is_active)

            normalized_variants.append(
                {
                    "id": variant_id,
                    "name": name,
                    "color_hex": color_hex,
                    "price": price,
                    "stock_quantity": stock_quantity,
                    "image": raw_variant.get("image", serializers.empty),
                    "image_upload_index": image_upload_index,
                    "is_active": is_active,
                    "position": position,
                }
            )

        return normalized_variants

    @staticmethod
    def _normalize_variant_price(raw_price) -> Decimal | None:
        """Parse an *explicitly sent* variant price override. ``None`` or ``""``
        means "clear the override and inherit Product.price". A missing ``price``
        key never reaches here -- ``_validate_variants_payload`` keeps it as
        ``serializers.empty`` so ``_sync_variants`` can leave the stored value
        untouched (same legacy tolerance ``stock_quantity`` already has). See
        docs/architecture/product-variant-pricing.md."""
        if raw_price in (None, ""):
            return None

        try:
            price = Decimal(str(raw_price))
        except (InvalidOperation, TypeError, ValueError):
            raise serializers.ValidationError(
                {"variants_payload": "O preco da variante deve ser um numero valido."}
            )

        if not price.is_finite() or price < 0:
            raise serializers.ValidationError(
                {"variants_payload": "O preco da variante nao pode ser negativo."}
            )

        if price.as_tuple().exponent < -2:
            raise serializers.ValidationError(
                {
                    "variants_payload": "O preco da variante deve ter no maximo 2 casas decimais."
                }
            )

        # ProductVariant.price is DecimalField(max_digits=10, decimal_places=2)
        # -- reject an out-of-range value here with a 400 instead of letting it
        # blow up at quantize() or at INSERT with a numeric-overflow 500.
        if price >= Decimal("1E8"):
            raise serializers.ValidationError(
                {"variants_payload": "O preco da variante e alto demais."}
            )

        try:
            return price.quantize(Decimal("0.01"))
        except InvalidOperation:
            raise serializers.ValidationError(
                {"variants_payload": "O preco da variante e alto demais."}
            )

    def get_images(self, instance):
        request = self.context.get("request")
        image_urls = instance.public_image_urls

        if request is not None:
            return [request.build_absolute_uri(url) for url in image_urls]

        base_url = getattr(settings, "BASE_URL", "http://127.0.0.1:8000")
        return [urljoin(base_url, url) for url in image_urls]

    def get_category_parent(self, instance: Product) -> int | None:
        return instance.category.parent_id

    def get_category_parent_name(self, instance: Product) -> str | None:
        return instance.category.parent.name if instance.category.parent_id else None

    def _replace_gallery(self, instance: Product, ordered_files: list) -> None:
        """Persist gallery images while keeping the first image as product cover."""
        cover_image = ordered_files[0] if ordered_files else None
        instance.image = cover_image
        instance.save(update_fields=["image"])

        instance.gallery_images.all().delete()

        for index, image_file in enumerate(ordered_files[1:], start=1):
            ProductGalleryImage.objects.create(
                product=instance,
                image=image_file,
                position=index,
            )

    def _build_current_image_lookup(
        self, instance: Product | None
    ) -> dict[str, object]:
        if not instance:
            return {}

        request = self.context.get("request")
        base_url = getattr(settings, "BASE_URL", "http://127.0.0.1:8000")
        current_by_url: dict[str, object] = {}

        def register_image(image_field) -> None:
            if not image_field:
                return

            relative_url = image_field.url
            absolute_url = (
                request.build_absolute_uri(relative_url)
                if request is not None
                else urljoin(base_url, relative_url)
            )

            current_by_url[relative_url] = image_field
            current_by_url[absolute_url] = image_field
            current_by_url[urlparse(relative_url).path] = image_field
            current_by_url[urlparse(absolute_url).path] = image_field

        register_image(instance.image)

        for gallery_item in instance.gallery_images.all():
            register_image(gallery_item.image)

        return current_by_url

    def _resolve_existing_image(self, instance: Product | None, url: str):
        if not instance or not url:
            return None

        current_by_url = self._build_current_image_lookup(instance)
        normalized_url = url.strip()
        normalized_path = urlparse(normalized_url).path
        return current_by_url.get(normalized_url) or current_by_url.get(normalized_path)

    def _resolve_existing_images(
        self, instance: Product | None, urls: list[str]
    ) -> list:
        resolved_files = []

        for url in urls:
            resolved_image = self._resolve_existing_image(instance, url)
            if resolved_image is not None:
                resolved_files.append(resolved_image)

        return resolved_files[:3]

    def _collect_indexed_request_values(
        self, request, field_name: str, *, files: bool
    ) -> list[tuple[int, object]]:
        source = request.FILES if files else request.data
        entries: list[tuple[int, object]] = []
        pattern = re.compile(rf"^{re.escape(field_name)}\[(\d+)\]$")

        if not hasattr(source, "keys"):
            return entries

        for key in source.keys():
            match = pattern.match(str(key))
            if not match:
                continue

            index = int(match.group(1))
            values = (
                source.getlist(key) if hasattr(source, "getlist") else [source.get(key)]
            )

            for value in values:
                if value in (None, ""):
                    continue
                entries.append((index, value))

        return sorted(entries, key=lambda item: item[0])

    def _extract_ordered_request_images(self) -> list[object] | None:
        request = self.context.get("request")
        if request is None:
            return None

        ordered_entries: list[tuple[int, object]] = []
        cover_image = request.FILES.get("image")

        if cover_image is not None:
            ordered_entries.append((0, cover_image))

        indexed_existing = self._collect_indexed_request_values(
            request, "existing_images", files=False
        )
        indexed_uploaded = self._collect_indexed_request_values(
            request, "uploaded_images", files=True
        )

        if indexed_existing or indexed_uploaded:
            ordered_entries.extend(indexed_existing)
            ordered_entries.extend(indexed_uploaded)
            ordered_entries.sort(key=lambda item: item[0])
            return [value for _, value in ordered_entries]

        fallback_entries: list[object] = []
        if cover_image is not None:
            fallback_entries.append(cover_image)

        if hasattr(request.data, "getlist"):
            fallback_entries.extend(
                value
                for value in request.data.getlist("existing_images")
                if isinstance(value, str) and value.strip()
            )

        if hasattr(request.FILES, "getlist"):
            fallback_entries.extend(
                value
                for value in request.FILES.getlist("uploaded_images")
                if value is not None
            )

        return fallback_entries or None

    def _resolve_ordered_request_images(self, instance: Product | None) -> list | None:
        ordered_entries = self._extract_ordered_request_images()
        if ordered_entries is None:
            return None

        resolved_images = []
        for entry in ordered_entries:
            if isinstance(entry, str):
                resolved_image = self._resolve_existing_image(instance, entry)
                if resolved_image is not None:
                    resolved_images.append(resolved_image)
                continue

            resolved_images.append(entry)

        return resolved_images

    def _resolve_variant_image(self, variant: ProductVariant | None, image_url: str):
        if not variant or not image_url or not variant.image:
            return None

        request = self.context.get("request")
        base_url = getattr(settings, "BASE_URL", "http://127.0.0.1:8000")
        relative_url = variant.image.url
        absolute_url = (
            request.build_absolute_uri(relative_url)
            if request is not None
            else urljoin(base_url, relative_url)
        )
        normalized_url = image_url.strip()
        normalized_path = urlparse(normalized_url).path

        if normalized_url in {relative_url, absolute_url}:
            return variant.image

        if normalized_path in {
            urlparse(relative_url).path,
            urlparse(absolute_url).path,
        }:
            return variant.image

        return None

    def _get_variant_upload(self, image_upload_index: int | None):
        if image_upload_index is None:
            return None

        request = self.context.get("request")
        if request is None:
            return None

        return request.FILES.get(f"variant_images[{image_upload_index}]")

    def _stock_movement_user(self):
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            return request.user
        return None

    def _record_variant_stock_movement(
        self,
        *,
        product: Product,
        variant: ProductVariant,
        previous_stock: int,
        new_stock: int,
        reason: str,
        notes: str,
    ) -> None:
        if previous_stock == new_stock:
            return

        movement_type = (
            StockMovement.TYPE_ENTRADA
            if new_stock > previous_stock
            else StockMovement.TYPE_SAIDA
        )

        StockMovement.objects.create(
            store=product.store,
            product=product,
            variant=variant,
            movement_type=movement_type,
            quantity=abs(new_stock - previous_stock),
            previous_stock=previous_stock,
            new_stock=new_stock,
            reason=reason,
            source=StockMovement.SOURCE_MANUAL,
            performed_by=self._stock_movement_user(),
            notes=notes,
        )

    def _sync_variants(
        self,
        product: Product,
        variants_payload: list[dict] | None,
        *,
        audit_stock_changes: bool = False,
        stock_movement_reason: str = StockMovement.REASON_AJUSTE_INVENTARIO,
        stock_movement_notes: str = "",
    ) -> None:
        if variants_payload is None:
            return

        submitted_ids = {
            variant_data["id"]
            for variant_data in variants_payload
            if variant_data["id"] is not None
        }

        with transaction.atomic():
            locked_product = Product.objects.select_for_update().get(id=product.id)
            existing_by_id = {
                variant.id: variant
                for variant in locked_product.variants.select_for_update().order_by(
                    "id"
                )
            }
            invalid_ids = submitted_ids - set(existing_by_id)
            if invalid_ids:
                raise serializers.ValidationError(
                    {
                        "variants_payload": "Uma ou mais variantes nao pertencem a este produto."
                    }
                )

            locked_product.variants.exclude(id__in=submitted_ids).delete()

            for index, variant_id in enumerate(sorted(submitted_ids)):
                variant = existing_by_id[variant_id]
                variant.name = f"__sync_variant_{variant.id}_{index}"
                variant.position = 1000 + index
                variant.save(update_fields=["name", "position", "updated_at"])

            for variant_data in sorted(
                variants_payload, key=lambda item: item["position"]
            ):
                variant_id = variant_data["id"]
                variant = (
                    existing_by_id.get(variant_id)
                    if variant_id is not None
                    else ProductVariant(product=locked_product)
                )
                previous_stock = variant.stock_quantity if variant_id is not None else 0

                variant.product = locked_product
                variant.name = variant_data["name"]
                variant.color_hex = variant_data["color_hex"]
                # Unaudited, unlike stock_quantity. An explicit null/"" (None)
                # clears the override; a *missing* key (serializers.empty) is a
                # legacy/stale client and must leave the stored value alone. A
                # brand-new variant starts at price=None, so skipping the
                # assignment there naturally yields NULL.
                if variant_data["price"] is not serializers.empty:
                    variant.price = variant_data["price"]
                if variant_data["stock_quantity"] is not None:
                    variant.stock_quantity = variant_data["stock_quantity"]
                elif variant_id is None:
                    variant.stock_quantity = 0
                variant.is_active = variant_data["is_active"]
                variant.position = variant_data["position"]

                uploaded_image = self._get_variant_upload(
                    variant_data["image_upload_index"]
                )
                if uploaded_image is not None:
                    variant.image = uploaded_image
                elif variant_data["image"] is None:
                    variant.image = None
                elif isinstance(variant_data["image"], str):
                    resolved_image = self._resolve_variant_image(
                        variant, variant_data["image"]
                    )
                    if resolved_image is not None:
                        variant.image = resolved_image

                variant.full_clean(exclude=["product"])
                variant.save()

                if audit_stock_changes:
                    self._record_variant_stock_movement(
                        product=locked_product,
                        variant=variant,
                        previous_stock=previous_stock,
                        new_stock=variant.stock_quantity,
                        reason=stock_movement_reason,
                        notes=stock_movement_notes,
                    )

            sync_product_stock_from_variants(locked_product)

            product.stock_quantity = locked_product.stock_quantity
            product.is_available = locked_product.is_available
            product.updated_at = locked_product.updated_at

            if hasattr(product, "_prefetched_objects_cache"):
                product._prefetched_objects_cache.pop("variants", None)

    def create(self, validated_data):
        ordered_request_images = self._resolve_ordered_request_images(None)
        uploaded_images = list(validated_data.pop("uploaded_images", []))
        validated_data.pop("existing_images", [])
        direct_image = validated_data.pop("image", None)
        variants_payload = validated_data.pop("variants_payload", None)

        if ordered_request_images is not None:
            product = super().create(validated_data)
            self._replace_gallery(product, ordered_request_images[:3])
            self._sync_variants(
                product,
                variants_payload,
                audit_stock_changes=True,
                stock_movement_reason=StockMovement.REASON_ENTRADA_INICIAL,
                stock_movement_notes="Entrada inicial de variante no cadastro do produto.",
            )
            return product

        if direct_image:
            uploaded_images.insert(0, direct_image)

        product = super().create(validated_data)
        self._replace_gallery(product, uploaded_images[:3])
        self._sync_variants(
            product,
            variants_payload,
            audit_stock_changes=True,
            stock_movement_reason=StockMovement.REASON_ENTRADA_INICIAL,
            stock_movement_notes="Entrada inicial de variante no cadastro do produto.",
        )
        return product

    def update(self, instance, validated_data):
        ordered_request_images = self._resolve_ordered_request_images(instance)
        uploaded_images = list(validated_data.pop("uploaded_images", []))
        existing_images = list(validated_data.pop("existing_images", []))
        direct_image = validated_data.pop("image", None)
        variants_payload = validated_data.pop("variants_payload", None)

        product = super().update(instance, validated_data)

        if ordered_request_images is not None:
            self._replace_gallery(product, ordered_request_images[:3])
            self._sync_variants(
                product,
                variants_payload,
                audit_stock_changes=True,
                stock_movement_notes="Ajuste direto de estoque da variante pelo formulario de produto.",
            )
            return product

        next_images = self._resolve_existing_images(product, existing_images)
        if direct_image:
            next_images.insert(0, direct_image)
        next_images.extend(uploaded_images)

        if existing_images or uploaded_images or direct_image is not None:
            self._replace_gallery(product, next_images[:3])

        self._sync_variants(
            product,
            variants_payload,
            audit_stock_changes=True,
            stock_movement_notes="Ajuste direto de estoque da variante pelo formulario de produto.",
        )
        return product

    def to_representation(self, instance):
        """
        Override to_representation to return absolute URL for image field.

        Converts the relative image path to an absolute URL for API responses.
        Also hands the base price down through context so the nested
        ProductVariantSerializer resolves an inherited effective_price without
        a query per variant on responses that skipped the list prefetch.
        """
        self.context["variant_base_price"] = instance.price
        data = super().to_representation(instance)
        request = self.context.get("request")

        if instance.image:
            if request is not None:
                data["image"] = request.build_absolute_uri(instance.image.url)
            else:
                # Fallback: build URL manually if no request context
                base_url = getattr(settings, "BASE_URL", "http://127.0.0.1:8000")
                data["image"] = urljoin(base_url, instance.image.url)
        else:
            data["image"] = None

        return data


class StockMovementSerializer(serializers.ModelSerializer):
    """Read-only representation of a stock movement for history/audit display.

    Used both nested under a product (Etapa 1's per-product history) and by
    the store-wide ledger (Etapa 2) -- product_name/sku are redundant in the
    former (the caller already has the product) but let the ledger render a
    flat table without a second per-row lookup.
    """

    movement_type_display = serializers.CharField(
        source="get_movement_type_display", read_only=True
    )
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)
    source_display = serializers.CharField(source="get_source_display", read_only=True)
    product_name = serializers.ReadOnlyField(source="product.name")
    product_sku = serializers.ReadOnlyField(source="product.sku")
    variant_name = serializers.ReadOnlyField(source="variant.name")
    variant_color_hex = serializers.ReadOnlyField(source="variant.color_hex")
    performed_by_username = serializers.ReadOnlyField(source="performed_by.username")
    sale_order_reference = serializers.ReadOnlyField(
        source="sale_order.order_reference"
    )

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "product",
            "product_name",
            "product_sku",
            "variant",
            "variant_name",
            "variant_color_hex",
            "movement_type",
            "movement_type_display",
            "quantity",
            "previous_stock",
            "new_stock",
            "reason",
            "reason_display",
            "source",
            "source_display",
            "sale_order",
            "sale_order_reference",
            "performed_by",
            "performed_by_username",
            "notes",
            "created_at",
        ]
        read_only_fields = fields


class StockMovementCreateSerializer(serializers.Serializer):
    """Validates the POST body for a manual stock movement.

    Not a ModelSerializer: the actual write happens through
    stock.apply_stock_movement(), not serializer.save(), since the mutation
    needs to lock the product row and compute previous/new stock atomically.
    """

    movement_type = serializers.ChoiceField(choices=StockMovement.TYPE_CHOICES)
    variant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    quantity = serializers.IntegerField(min_value=1)
    reason = serializers.ChoiceField(choices=StockMovement.REASON_CHOICES)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    def validate_reason(self, value):
        if value in StockMovement.SYSTEM_ONLY_REASONS:
            raise serializers.ValidationError(
                "Este motivo é de uso exclusivo do sistema."
            )
        return value


class DeliveryRegionSerializer(serializers.ModelSerializer):
    """Delivery region fee configuration used by dashboard and public checkout."""

    class Meta:
        model = DeliveryRegion
        fields = [
            "id",
            "name",
            "city",
            "neighborhoods",
            "delivery_fee",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


FEEDBACK_HONEYPOT_FIELDS = ("website", "company")


class CustomerFeedbackCreateSerializer(serializers.Serializer):
    """Public, unauthenticated-friendly feedback submission.

    Shape validation only -- store/customer/product/order resolution against
    the request's actual tenant happens in the view (same split as
    CheckoutRequestSerializer / CheckoutWhatsAppView), since this serializer
    has no access to the resolved store.
    """

    type = serializers.ChoiceField(choices=CustomerFeedback.TYPE_CHOICES, source="feedback_type")
    message = serializers.CharField(
        max_length=2000, trim_whitespace=True, allow_blank=False
    )
    contact = serializers.CharField(
        max_length=160, required=False, allow_blank=True, trim_whitespace=True, default=""
    )
    page_path = serializers.CharField(
        max_length=512, required=False, allow_blank=True, trim_whitespace=True, default=""
    )
    product_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    order_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    correlation_id = serializers.CharField(
        max_length=64, required=False, allow_blank=True, trim_whitespace=True, default=""
    )

    def validate_message(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Conte o que aconteceu para enviarmos seu relato.")
        return value.strip()

    def validate_page_path(self, value: str) -> str:
        """Keep only a same-origin route, never an absolute URL with query/hash secrets."""
        if not value:
            return ""
        parsed = urlparse(value)
        return parsed.path[:512] if parsed.path else ""

    def validate(self, attrs):
        """Reject autofilled honeypot fields without changing the public contract."""
        initial_data = self.initial_data if hasattr(self, "initial_data") else {}
        if not hasattr(initial_data, "get"):
            return attrs

        for field_name in FEEDBACK_HONEYPOT_FIELDS:
            value = initial_data.get(field_name)
            if value and str(value).strip():
                raise serializers.ValidationError("Invalid feedback request")
        return attrs


class CustomerFeedbackSerializer(serializers.ModelSerializer):
    """Dashboard read view of one feedback report."""

    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    order_reference = serializers.CharField(
        source="order.order_reference", read_only=True, default=None
    )
    customer_name = serializers.CharField(
        source="customer_profile.full_name", read_only=True, default=""
    )
    customer_phone = serializers.CharField(
        source="customer_profile.phone", read_only=True, default=""
    )

    class Meta:
        model = CustomerFeedback
        fields = [
            "id",
            "feedback_type",
            "message",
            "contact",
            "page_path",
            "product",
            "product_name",
            "order",
            "order_reference",
            "customer_name",
            "customer_phone",
            "correlation_id",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class CustomerFeedbackStatusUpdateSerializer(serializers.Serializer):
    """Dashboard status transition for one feedback report."""

    status = serializers.ChoiceField(choices=CustomerFeedback.STATUS_CHOICES)


PUBLIC_STORE_SETTINGS_FIELDS = ("whatsapp_phone_digits", "is_whatsapp_configured")


class StoreSerializer(serializers.ModelSerializer):
    """Resolved tenant identity. Etapa 1: always the single default store."""

    status = serializers.SerializerMethodField()
    theme = serializers.SerializerMethodField()

    class Meta:
        model = Store
        fields = [
            "id",
            "name",
            "display_name",
            "slug",
            "logo_url",
            "tagline",
            "whatsapp_phone",
            "theme",
            "is_active",
            "status",
            "receipt_exchange_policy",
            "receipt_paper_format",
        ]
        read_only_fields = fields

    def get_status(self, store: Store) -> str:
        return "active" if store.is_active else "inactive"

    def get_theme(self, store: Store) -> dict[str, str]:
        return Store.normalize_theme(store.theme)


class LabelSettingsSerializer(serializers.ModelSerializer):
    """Printable product-label sheet settings scoped to one store."""

    labels_per_page = serializers.IntegerField(read_only=True)

    class Meta:
        model = LabelSettings
        fields = [
            "page_format",
            "columns",
            "rows",
            "margin_mm",
            "cell_padding_mm",
            "qr_size_mm",
            "show_price",
            "show_size",
            "show_public_code",
            "labels_per_page",
        ]
        read_only_fields = ["labels_per_page"]


class StoreAppearanceSettingsSerializer(serializers.Serializer):
    """Validate storefront appearance updates controlled by the theme engine."""

    display_name = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )
    logo_url = serializers.URLField(
        max_length=500,
        required=False,
        allow_blank=True,
    )
    tagline = serializers.CharField(
        max_length=160,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )
    theme = serializers.JSONField(required=False)

    def validate_theme(self, value):
        return Store.normalize_theme(value)

    def validate_logo_url(self, value):
        return validate_storefront_media_url_ownership(
            value,
            store=self.context.get("store"),
            field_name="logo_url",
        )


class StorefrontDestinationSerializerMixin:
    """Normalize friendly CTA destinations into safe storefront URLs."""

    def _normalize_destination_attrs(
        self,
        attrs: dict,
        *,
        prefix: str = "",
        url_field: str = "button_url",
        required_on_create: bool = False,
    ) -> dict:
        type_field = f"{prefix}destination_type"
        value_field = f"{prefix}destination_value"
        instance = getattr(self, "instance", None)
        store: Store = self.context["store"]

        if (
            instance is not None
            and type_field not in attrs
            and value_field not in attrs
        ):
            return attrs

        current_type = (
            getattr(instance, type_field, StorefrontDestination.NONE)
            if instance is not None
            else StorefrontDestination.NONE
        )
        current_value = (
            getattr(instance, value_field, "")
            if instance is not None
            else ""
        )
        destination_type = attrs.get(type_field, current_type) or StorefrontDestination.NONE
        raw_value = str(attrs.get(value_field, current_value) or "").strip()

        if destination_type in {
            StorefrontDestination.NONE,
            StorefrontDestination.PRODUCTS,
        }:
            normalized_value = ""
        elif destination_type == StorefrontDestination.CATEGORY:
            normalized_value = self._validate_destination_object_id(
                raw_value,
                model=Category,
                store=store,
                field_name=value_field,
                message="Selecione uma categoria desta loja.",
            )
        elif destination_type == StorefrontDestination.PRODUCT:
            normalized_value = self._validate_destination_object_id(
                raw_value,
                model=Product,
                store=store,
                field_name=value_field,
                message="Selecione um produto desta loja.",
            )
        elif destination_type == StorefrontDestination.EXTERNAL_URL:
            if not raw_value:
                raise serializers.ValidationError(
                    {value_field: "Informe o link externo."}
                )
            normalized_value = serializers.URLField(max_length=500).run_validation(
                raw_value
            )
        else:
            raise serializers.ValidationError(
                {type_field: "Destino do CTA invalido."}
            )

        if required_on_create and destination_type == StorefrontDestination.NONE:
            normalized_value = ""

        attrs[type_field] = destination_type
        attrs[value_field] = normalized_value
        attrs[url_field] = StorefrontDestination.build_url(
            store,
            destination_type,
            normalized_value,
        )
        return attrs

    @staticmethod
    def _validate_destination_object_id(
        raw_value: str,
        *,
        model,
        store: Store,
        field_name: str,
        message: str,
    ) -> str:
        if not raw_value:
            raise serializers.ValidationError({field_name: message})

        try:
            object_id = int(raw_value)
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError({field_name: message}) from error

        if not model.objects.filter(store=store, id=object_id).exists():
            raise serializers.ValidationError({field_name: message})

        return str(object_id)


class StorefrontAppearanceSerializer(
    StorefrontDestinationSerializerMixin,
    serializers.ModelSerializer,
):
    """Dashboard-owned read/write for the extended storefront personalization.

    Colors stay on Store.theme/StoreAppearanceSettingsSerializer; this only
    covers what Store doesn't already model (see StorefrontAppearance's
    docstring).
    """

    store_id = serializers.IntegerField(read_only=True)
    hero_cta_url = serializers.CharField(read_only=True)

    class Meta:
        model = StorefrontAppearance
        fields = [
            "id",
            "store_id",
            "secondary_color",
            "favicon_url",
            "hero_enabled",
            "hero_image_desktop",
            "hero_image_mobile",
            "hero_alt_text",
            "hero_title",
            "hero_subtitle",
            "hero_cta_text",
            "hero_destination_type",
            "hero_destination_value",
            "hero_cta_url",
            "card_style",
            "radius_style",
            "density",
            "font_preset",
            "motion_enabled",
            "motion_intensity",
            "decoration_enabled",
            "decoration_style",
            "updated_at",
        ]
        read_only_fields = ["id", "store_id", "updated_at"]

    def validate_secondary_color(self, value: str) -> str:
        normalized_value = str(value or "").strip()
        if not normalized_value:
            return ""
        if not ProductVariant.COLOR_HEX_VALIDATOR.regex.match(normalized_value):
            raise serializers.ValidationError(
                "Informe uma cor hexadecimal no formato #RRGGBB."
            )
        return normalized_value.upper()

    def validate_favicon_url(self, value: str) -> str:
        return validate_storefront_media_url_ownership(
            value,
            store=self.context.get("store"),
            field_name="favicon_url",
        )

    def validate_hero_image_desktop(self, value: str) -> str:
        return validate_storefront_media_url_ownership(
            value,
            store=self.context.get("store"),
            field_name="hero_image_desktop",
        )

    def validate_hero_image_mobile(self, value: str) -> str:
        return validate_storefront_media_url_ownership(
            value,
            store=self.context.get("store"),
            field_name="hero_image_mobile",
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        return self._normalize_destination_attrs(
            attrs,
            prefix="hero_",
            url_field="hero_cta_url",
        )


class StorefrontMediaUploadSerializer(serializers.Serializer):
    """Validate and persist tenant-scoped storefront media uploads."""

    KIND_LOGO = "logo"
    KIND_BANNER = "banner"
    KIND_FAVICON = "favicon"
    KIND_PROMOTION = "promotion"
    KIND_CHOICES = (
        (KIND_LOGO, "Logo"),
        (KIND_BANNER, "Banner"),
        (KIND_FAVICON, "Favicon"),
        (KIND_PROMOTION, "Promocao"),
    )

    ALLOWED_IMAGE_TYPES = SAFE_IMAGE_UPLOAD_TYPES
    MAX_BYTES_BY_KIND = {
        KIND_LOGO: 2 * 1024 * 1024,
        KIND_BANNER: 5 * 1024 * 1024,
        KIND_FAVICON: 1 * 1024 * 1024,
        KIND_PROMOTION: 5 * 1024 * 1024,
    }
    FOLDER_BY_KIND = {
        KIND_LOGO: "logo",
        KIND_BANNER: "banners",
        KIND_FAVICON: "favicon",
        KIND_PROMOTION: "promotions",
    }

    kind = serializers.ChoiceField(choices=KIND_CHOICES)
    file = serializers.ImageField(write_only=True, allow_empty_file=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        kind = attrs["kind"]
        uploaded_file = attrs["file"]
        content_type, extension = validate_safe_image_upload(
            uploaded_file,
            max_bytes=self.MAX_BYTES_BY_KIND[kind],
        )

        attrs["_content_type"] = content_type
        attrs["_extension"] = extension
        return attrs

    def save(self, **kwargs):
        store: Store = self.context["store"]
        request = self.context.get("request")
        kind = self.validated_data["kind"]
        uploaded_file = self.validated_data["file"]
        extension = self.validated_data["_extension"]
        content_type = self.validated_data["_content_type"]
        folder = self.FOLDER_BY_KIND[kind]
        storage_path = (
            f"stores/{store.id}/storefront/{folder}/{uuid.uuid4().hex}.{extension}"
        )

        uploaded_file.seek(0)
        stored_path = default_storage.save(storage_path, uploaded_file)
        media_url = default_storage.url(stored_path)
        if request is not None:
            media_url = request.build_absolute_uri(media_url)
        elif not urlparse(media_url).scheme:
            media_url = urljoin(getattr(settings, "BASE_URL", "http://127.0.0.1:8000"), media_url)

        return {
            "kind": kind,
            "url": media_url,
            "path": stored_path,
            "size": uploaded_file.size,
            "content_type": content_type,
        }


class StorefrontBannerSerializer(
    StorefrontDestinationSerializerMixin,
    serializers.ModelSerializer,
):
    """Dashboard CRUD serializer for tenant-scoped promotional banners."""

    store_id = serializers.IntegerField(read_only=True)
    status = serializers.CharField(read_only=True)
    button_url = serializers.CharField(read_only=True)
    position = serializers.IntegerField(required=False, min_value=0)

    class Meta:
        model = StorefrontBanner
        fields = [
            "id",
            "store_id",
            "image_url",
            "alt_text",
            "title",
            "subtitle",
            "cta_text",
            "destination_type",
            "destination_value",
            "button_url",
            "position",
            "is_active",
            "status",
            "starts_at",
            "ends_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "store_id",
            "button_url",
            "status",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        attrs = self._normalize_destination_attrs(attrs)

        starts_at = attrs.get(
            "starts_at",
            getattr(self.instance, "starts_at", None),
        )
        ends_at = attrs.get(
            "ends_at",
            getattr(self.instance, "ends_at", None),
        )
        if starts_at and ends_at and starts_at > ends_at:
            raise serializers.ValidationError(
                {"ends_at": "A data final deve ser posterior ao inicio."}
            )
        return attrs

    def validate_image_url(self, value: str) -> str:
        return validate_storefront_media_url_ownership(
            value,
            store=self.context.get("store"),
            field_name="image_url",
        )

    def create(self, validated_data):
        store: Store = self.context["store"]
        if "position" not in validated_data:
            last_position = (
                StorefrontBanner.objects.filter(store=store)
                .order_by("-position", "-id")
                .values_list("position", flat=True)
                .first()
            )
            validated_data["position"] = 0 if last_position is None else last_position + 1
        return StorefrontBanner.objects.create(store=store, **validated_data)


class PublicStorefrontBannerSerializer(serializers.ModelSerializer):
    """Public, visitor-safe promotional banner payload."""

    status = serializers.CharField(read_only=True)

    class Meta:
        model = StorefrontBanner
        fields = [
            "image_url",
            "alt_text",
            "title",
            "subtitle",
            "cta_text",
            "button_url",
            "position",
            "status",
        ]
        read_only_fields = fields


class StorefrontBannerReorderSerializer(serializers.Serializer):
    """Persist merchant-defined promotional banner order."""

    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )

    def validate_ids(self, value):
        store: Store = self.context["store"]
        unique_ids = list(dict.fromkeys(value))
        if len(unique_ids) != len(value):
            raise serializers.ValidationError("Nao repita banners na ordenacao.")

        current_ids = set(
            StorefrontBanner.objects.filter(store=store).values_list("id", flat=True)
        )
        if current_ids != set(unique_ids):
            raise serializers.ValidationError(
                "Envie todos os banners desta loja para reordenar."
            )
        return unique_ids


class PublicStorefrontAppearanceSerializer(serializers.ModelSerializer):
    """Safe public storefront appearance -- never memberships/owner/secrets.

    Merged with the store's own public identity (name/logo/theme) by the
    view, since a storefront visitor needs both to render the vitrine.
    """

    store_name = serializers.SerializerMethodField()
    store_slug = serializers.CharField(source="store.slug", read_only=True)
    logo_url = serializers.CharField(source="store.logo_url", read_only=True)
    tagline = serializers.CharField(source="store.tagline", read_only=True)
    theme = serializers.SerializerMethodField()
    merchant = serializers.SerializerMethodField()

    class Meta:
        model = StorefrontAppearance
        fields = [
            "store_name",
            "store_slug",
            "logo_url",
            "tagline",
            "theme",
            "merchant",
            "secondary_color",
            "favicon_url",
            "hero_enabled",
            "hero_image_desktop",
            "hero_image_mobile",
            "hero_alt_text",
            "hero_title",
            "hero_subtitle",
            "hero_cta_text",
            "hero_destination_type",
            "hero_destination_value",
            "hero_cta_url",
            "card_style",
            "radius_style",
            "density",
            "font_preset",
            "motion_enabled",
            "motion_intensity",
            "decoration_enabled",
            "decoration_style",
        ]
        read_only_fields = fields

    def get_theme(self, appearance: StorefrontAppearance) -> dict[str, str]:
        return Store.normalize_theme(appearance.store.theme)

    def get_store_name(self, appearance: StorefrontAppearance) -> str:
        return appearance.store.display_name.strip() or appearance.store.name

    def get_merchant(self, appearance: StorefrontAppearance) -> dict:
        """Storefront-safe merchant fields only (PUBLIC_FIELDS). A read never
        creates the row -- an unsaved instance keeps the payload shape stable
        for a store that has not filled its profile yet."""
        profile = MerchantProfile.objects.filter(store=appearance.store).first()
        return dict(PublicMerchantProfileSerializer(profile or MerchantProfile()).data)


class StoreRenameSerializer(serializers.Serializer):
    """Validate a store rename request (Etapa 4: owners can fix a store's name)."""

    name = serializers.CharField(max_length=120, trim_whitespace=True)

    def validate_name(self, value: str) -> str:
        normalized_name = value.strip()
        if len(normalized_name) < 2:
            raise serializers.ValidationError(
                "Informe um nome de loja com pelo menos 2 caracteres."
            )
        return normalized_name


class StoreReceiptSettingsSerializer(serializers.Serializer):
    """Validate a PDV receipt settings update (exchange policy + print format).

    Both fields are optional so the dashboard's "Recibo" settings tab can
    send just the one field the merchant edited -- a blank
    `receipt_exchange_policy` is a valid, meaningful value (it means "don't
    show a policy line on the printed receipt at all"), not an omission.
    """

    receipt_exchange_policy = serializers.CharField(
        max_length=280, required=False, allow_blank=True, trim_whitespace=True
    )
    receipt_paper_format = serializers.ChoiceField(
        choices=Store.RECEIPT_PAPER_FORMAT_CHOICES, required=False
    )


class PublicStoreSettingsSerializer(serializers.ModelSerializer):
    """Safe public store contact settings exposed to the catalog."""

    whatsapp_phone_digits = serializers.SerializerMethodField()
    is_whatsapp_configured = serializers.SerializerMethodField()

    class Meta:
        model = StoreSettings
        fields = PUBLIC_STORE_SETTINGS_FIELDS
        read_only_fields = PUBLIC_STORE_SETTINGS_FIELDS

    def get_whatsapp_phone_digits(self, settings_instance: StoreSettings) -> str:
        """Return normalized phone digits used by checkout redirects."""
        return settings_instance.whatsapp_phone_digits

    def get_is_whatsapp_configured(self, settings_instance: StoreSettings) -> bool:
        """Expose whether checkout can generate a direct WhatsApp URL."""
        return bool(settings_instance.whatsapp_phone_digits)


class StoreSettingsSerializer(PublicStoreSettingsSerializer):
    """Dashboard-owned store settings used by the public checkout."""

    class Meta(PublicStoreSettingsSerializer.Meta):
        fields = [
            "id",
            "whatsapp_phone",
            "whatsapp_phone_digits",
            "is_whatsapp_configured",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            *PUBLIC_STORE_SETTINGS_FIELDS,
            "created_at",
            "updated_at",
        ]

    def validate_whatsapp_phone(self, value: str) -> str:
        """Accept formatted phone input but persist digits for reliable wa.me links."""
        phone = value.strip()

        if not phone:
            return ""

        phone_digits = StoreSettings.normalize_phone(phone)

        if len(phone_digits) < 10 or len(phone_digits) > 15:
            raise serializers.ValidationError(
                "Informe o WhatsApp com DDD e codigo do pais. Ex.: 5571999999999."
            )

        return phone_digits


def _as_serializer_validation_error(error: DjangoValidationError) -> None:
    messages = getattr(error, "messages", None)
    if messages and len(messages) == 1:
        raise serializers.ValidationError(messages[0]) from error
    raise serializers.ValidationError(messages or str(error)) from error


class MerchantProfileSerializer(serializers.ModelSerializer):
    """Read/write the resolved store's commercial identity, contact, address
    and social links (COMMERCE P1).

    Explicit field list (never ``__all__``): ``store``/``id`` are deliberately
    not exposed, so a client can neither read the tenant linkage nor attempt
    to reassign it -- the view owns the instance, resolved from the
    authenticated store context. PATCH is partial: an omitted field keeps its
    stored value; an empty string is an explicit "clear this field".
    """

    is_complete = serializers.BooleanField(read_only=True)
    has_complete_address = serializers.BooleanField(read_only=True)
    # choices already reject unknown UFs; allow_blank keeps "" (not set) valid.
    state = serializers.ChoiceField(
        choices=MerchantProfile.UF_CHOICES,
        required=False,
        allow_blank=True,
    )
    # Accept masked input ("11.222.333/0001-81", "40010-000", "(71) 3333-4444")
    # and normalize to digits in validate_*; the wider max_length here keeps
    # the model column's tighter limit from rejecting the mask before the
    # field-level validator can strip it.
    tax_id = serializers.CharField(
        required=False, allow_blank=True, max_length=32, trim_whitespace=True
    )
    contact_phone = serializers.CharField(
        required=False, allow_blank=True, max_length=32, trim_whitespace=True
    )
    postal_code = serializers.CharField(
        required=False, allow_blank=True, max_length=16, trim_whitespace=True
    )

    class Meta:
        model = MerchantProfile
        fields = [
            "legal_name",
            "trade_name",
            "tax_id",
            "contact_email",
            "contact_phone",
            "postal_code",
            "street",
            "number",
            "complement",
            "district",
            "city",
            "state",
            "country",
            "website_url",
            "instagram_url",
            "facebook_url",
            "tiktok_url",
            "youtube_url",
            "is_complete",
            "has_complete_address",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "is_complete",
            "has_complete_address",
            "created_at",
            "updated_at",
        ]

    def validate_tax_id(self, value: str) -> str:
        try:
            return clean_merchant_tax_id(value)
        except DjangoValidationError as error:
            _as_serializer_validation_error(error)

    def validate_contact_phone(self, value: str) -> str:
        try:
            return clean_merchant_contact_phone(value)
        except DjangoValidationError as error:
            _as_serializer_validation_error(error)

    def validate_postal_code(self, value: str) -> str:
        try:
            return clean_merchant_postal_code(value)
        except DjangoValidationError as error:
            _as_serializer_validation_error(error)

    def validate_country(self, value: str) -> str:
        try:
            return clean_merchant_country(value)
        except DjangoValidationError as error:
            _as_serializer_validation_error(error)

    def _validate_public_url(self, field_name: str, value: str) -> str:
        try:
            return clean_merchant_public_url(field_name, value)
        except DjangoValidationError as error:
            _as_serializer_validation_error(error)

    def validate_website_url(self, value: str) -> str:
        return self._validate_public_url("website_url", value)

    def validate_instagram_url(self, value: str) -> str:
        return self._validate_public_url("instagram_url", value)

    def validate_facebook_url(self, value: str) -> str:
        return self._validate_public_url("facebook_url", value)

    def validate_tiktok_url(self, value: str) -> str:
        return self._validate_public_url("tiktok_url", value)

    def validate_youtube_url(self, value: str) -> str:
        return self._validate_public_url("youtube_url", value)


class PublicMerchantProfileSerializer(serializers.ModelSerializer):
    """Storefront-safe subset of the merchant profile.

    Only MerchantProfile.PUBLIC_FIELDS -- never legal_name, tax_id, contact
    e-mail/phone, or the street-level address. Read-only.
    """

    class Meta:
        model = MerchantProfile
        fields = list(MerchantProfile.PUBLIC_FIELDS)
        read_only_fields = fields


class BotMessageRequestSerializer(serializers.Serializer):
    """Incoming public message handled by the rule-based bot MVP."""

    message = serializers.CharField(max_length=500, trim_whitespace=True)
    conversation_id = serializers.IntegerField(
        required=False, allow_null=True, min_value=1
    )
    session_id = serializers.CharField(required=False, allow_blank=True, max_length=64)
    customer_phone = serializers.CharField(
        required=False, allow_blank=True, max_length=32
    )
    channel = serializers.ChoiceField(
        choices=["web", "whatsapp"],
        default="web",
        required=False,
    )


class BotOptionSerializer(serializers.Serializer):
    """Small command option that a frontend widget can render as a quick reply."""

    label = serializers.CharField()
    value = serializers.CharField()
    kind = serializers.ChoiceField(
        choices=["quick_reply", "whatsapp_link"],
        default="quick_reply",
        required=False,
    )
    description = serializers.CharField(required=False, allow_blank=True)
    url = serializers.CharField(required=False, allow_blank=True)


class BotProductSuggestionSerializer(serializers.Serializer):
    """Compact product payload for bot replies."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    slug = serializers.CharField(allow_blank=True, allow_null=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    stock_quantity = serializers.IntegerField()


class BotDeliveryRegionSuggestionSerializer(serializers.Serializer):
    """Compact active delivery region payload for bot replies."""

    id = serializers.IntegerField()
    name = serializers.CharField()
    city = serializers.CharField(allow_blank=True)
    delivery_fee = serializers.DecimalField(max_digits=10, decimal_places=2)


class BotMessageResponseSerializer(serializers.Serializer):
    """Structured response from the rule-based bot MVP."""

    conversation_id = serializers.IntegerField()
    session_id = serializers.CharField()
    conversation_status = serializers.CharField()
    intent = serializers.ChoiceField(
        choices=[
            "greeting",
            "catalog",
            "product_search",
            "delivery",
            "checkout",
            "human_support",
            "fallback",
        ]
    )
    reply = serializers.CharField()
    options = BotOptionSerializer(many=True)
    products = BotProductSuggestionSerializer(many=True)
    delivery_regions = BotDeliveryRegionSuggestionSerializer(many=True)


class BotConversationMessageSerializer(serializers.ModelSerializer):
    """Read-only persisted bot message for dashboard review."""

    class Meta:
        model = BotMessage
        fields = [
            "id",
            "role",
            "content",
            "intent",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class BotConversationOrderSerializer(serializers.Serializer):
    """The order a bot conversation converted into, shown on the dashboard."""

    order_reference = serializers.CharField()
    status = serializers.CharField()
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    created_at = serializers.DateTimeField()


class BotConversationSummarySerializer(serializers.ModelSerializer):
    """Compact bot conversation payload for dashboard lists."""

    message_count = serializers.SerializerMethodField()
    last_message_preview = serializers.SerializerMethodField()
    sale_order = BotConversationOrderSerializer(read_only=True, allow_null=True)

    class Meta:
        model = BotConversation
        fields = [
            "id",
            "session_id",
            "channel",
            "customer_phone",
            "status",
            "last_intent",
            "message_count",
            "last_message_preview",
            "sale_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_message_count(self, conversation: BotConversation) -> int:
        """Return the number of persisted messages in the conversation."""
        annotated_count = getattr(conversation, "message_count", None)
        if annotated_count is not None:
            return annotated_count

        return conversation.messages.count()

    def get_last_message_preview(self, conversation: BotConversation) -> str:
        """Return a short preview of the latest message for list scanning."""
        latest_message = conversation.messages.order_by("-created_at", "-id").first()
        if latest_message is None:
            return ""

        return latest_message.content[:120]


class BotConversationDetailSerializer(BotConversationSummarySerializer):
    """Detailed bot conversation payload including persisted messages."""

    messages = BotConversationMessageSerializer(many=True, read_only=True)

    class Meta(BotConversationSummarySerializer.Meta):
        fields = [
            *BotConversationSummarySerializer.Meta.fields,
            "messages",
        ]


class CheckoutItemInputSerializer(serializers.Serializer):
    """Serializer for each cart item sent during checkout."""

    product_id = serializers.IntegerField(min_value=1)
    variant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class CheckoutCustomerInputSerializer(serializers.Serializer):
    """Serializer for the per-order choices collected at checkout, plus
    guest identity/address.

    Guest checkout reinstated: identity/address (full_name, phone, email,
    address, neighborhood, city) are optional here -- `CheckoutWhatsAppView`
    prefers the authenticated customer's `CustomerProfile` when one exists
    and is complete, and only falls back to these submitted fields
    otherwise (no profile, or a profile missing its address). Presence is
    enforced there, not here, since that decision depends on the resolved
    profile, which this serializer has no access to.
    """

    delivery_method = serializers.ChoiceField(choices=["delivery", "pickup"])
    payment_method = serializers.ChoiceField(choices=["pix", "card", "cash"])
    delivery_region_id = serializers.IntegerField(
        required=False, allow_null=True, min_value=1
    )
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    full_name = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        default="",
    )
    phone = serializers.CharField(
        max_length=32,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        default="",
    )
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    address = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        default="",
    )
    neighborhood = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        default="",
    )
    city = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        default="",
    )


CHECKOUT_HONEYPOT_FIELDS = ("website", "company")


class CheckoutRequestSerializer(serializers.Serializer):
    """Serializer for the public product checkout request."""

    items = CheckoutItemInputSerializer(many=True)
    customer = CheckoutCustomerInputSerializer()
    bot_session_id = serializers.CharField(required=False, allow_blank=True, default="")
    idempotency_key = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=128,
        trim_whitespace=True,
    )

    @staticmethod
    def _submitted_text(data, field_name: str) -> str:
        if not hasattr(data, "get"):
            return ""

        value = data.get(field_name)
        if isinstance(value, (list, tuple)):
            value = value[0] if value else None

        return "" if value is None else str(value).strip()

    def validate_items(self, value):
        """Ensure the cart has at least one item."""
        if not value:
            raise serializers.ValidationError("items must contain at least one product")
        return value

    def validate_idempotency_key(self, value: str) -> str:
        if not value:
            return ""

        if not re.fullmatch(r"[A-Za-z0-9:_-]{8,128}", value):
            raise serializers.ValidationError(
                "A chave de idempotencia deve ter 8 a 128 caracteres seguros."
            )

        return value

    def validate(self, attrs):
        """Reject autofilled honeypot fields without changing the public contract."""
        initial_data = self.initial_data if hasattr(self, "initial_data") else {}
        customer_data = (
            initial_data.get("customer", {}) if hasattr(initial_data, "get") else {}
        )

        for field_name in CHECKOUT_HONEYPOT_FIELDS:
            if self._submitted_text(initial_data, field_name) or self._submitted_text(
                customer_data,
                field_name,
            ):
                raise serializers.ValidationError("Invalid checkout request")

        return attrs


class CheckoutItemResponseSerializer(serializers.Serializer):
    """Normalized item details returned after checkout preparation."""

    product_id = serializers.IntegerField()
    variant_id = serializers.IntegerField(allow_null=True, required=False)
    product_name = serializers.CharField()
    sku = serializers.CharField(allow_blank=True)
    variant_name = serializers.CharField(allow_blank=True, required=False)
    variant_color_hex = serializers.CharField(allow_blank=True, required=False)
    variant_image_url = serializers.CharField(allow_blank=True, required=False)
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2)


class CheckoutCustomerResponseSerializer(serializers.Serializer):
    """Normalized customer details returned after checkout preparation."""

    full_name = serializers.CharField()
    phone = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    delivery_method = serializers.ChoiceField(choices=["delivery", "pickup"])
    payment_method = serializers.ChoiceField(choices=["pix", "card", "cash"])
    address = serializers.CharField(allow_blank=True)
    neighborhood = serializers.CharField(allow_blank=True)
    city = serializers.CharField(allow_blank=True)
    delivery_region_id = serializers.IntegerField(allow_null=True, required=False)
    delivery_region_name = serializers.CharField(allow_blank=True, required=False)
    notes = serializers.CharField(allow_blank=True)


class CheckoutResponseSerializer(serializers.Serializer):
    """Serializer for the checkout preparation response."""

    order_reference = serializers.CharField()
    items = CheckoutItemResponseSerializer(many=True)
    customer = CheckoutCustomerResponseSerializer()
    subtotal = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    delivery_fee = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    total = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0.00")
    )
    message = serializers.CharField()
    whatsapp_url = serializers.CharField(allow_blank=True)


class SaleOrderItemSerializer(serializers.ModelSerializer):
    """Read-only sale item snapshot for dashboard history."""

    product_id = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = SaleOrderItem
        fields = [
            "id",
            "product_id",
            "variant_id",
            "product_name",
            "sku",
            "variant_name",
            "variant_color_hex",
            "variant_image_url",
            "quantity",
            "unit_price",
            "line_total",
        ]


class SaleOrderSerializer(serializers.ModelSerializer):
    """Read-only sale order payload for the dashboard menu and history screens."""

    items = SaleOrderItemSerializer(many=True, read_only=True)
    item_count = serializers.SerializerMethodField()
    performed_by_username = serializers.ReadOnlyField(source="performed_by.username")

    class Meta:
        model = SaleOrder
        fields = [
            "id",
            "order_reference",
            "status",
            "channel",
            "customer_name",
            "customer_phone",
            "customer_email",
            "delivery_method",
            "payment_method",
            "subtotal",
            "delivery_fee",
            "delivery_region_name",
            "total",
            "created_at",
            "item_count",
            "items",
            "performed_by_username",
        ]

    def get_item_count(self, order: SaleOrder) -> int:
        """Return the total number of product units in the order."""
        return sum(item.quantity for item in order.items.all())


class SaleOrderDetailSerializer(SaleOrderSerializer):
    """Full sale order payload for the dashboard's order detail view.

    Adds delivery address, customer notes/message and shipping data on top
    of the list payload (Etapas 0/1 of the pedidos/NF/envio evolution) --
    kept out of SaleOrderSerializer so the list endpoint doesn't inflate
    every row with fields only the detail screen needs.
    """

    class Meta(SaleOrderSerializer.Meta):
        fields = SaleOrderSerializer.Meta.fields + [
            "address",
            "neighborhood",
            "city",
            "notes",
            "message",
            "whatsapp_url",
            "carrier_name",
            "tracking_code",
            "tracking_url",
            "shipped_at",
            "delivered_at",
        ]


class SaleOrderStatusUpdateSerializer(serializers.Serializer):
    """Validate dashboard sale status transitions.

    carrier_name/tracking_code are only required when the transition target
    is "sent" -- that dependency is checked in the view, where the current
    order's delivery_method is known (see get_allowed_next_statuses in
    shipping.py, Etapa 1 of the pedidos/NF/envio evolution).
    """

    status = serializers.ChoiceField(
        choices=[choice[0] for choice in SaleOrder.STATUS_CHOICES],
    )
    carrier_name = serializers.CharField(
        required=False, allow_blank=True, max_length=120
    )
    tracking_code = serializers.CharField(
        required=False, allow_blank=True, max_length=64
    )


class SaleOrderSummarySerializer(serializers.Serializer):
    """Aggregated real sales revenue for the dashboard's revenue card."""

    period = serializers.CharField()
    revenue_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    orders_count = serializers.IntegerField()
    average_ticket = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    comparison_previous_period = serializers.DecimalField(
        max_digits=6, decimal_places=2, allow_null=True
    )
    comparison_same_period_last_year = serializers.DecimalField(
        max_digits=6, decimal_places=2, allow_null=True
    )


class SaleOrderTimeseriesPointSerializer(serializers.Serializer):
    """One day of aggregated sales for the dashboard's revenue trend chart."""

    date = serializers.DateField()
    revenue = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    orders_count = serializers.IntegerField()


class TopProductBreakdownSerializer(serializers.Serializer):
    """A best-selling product within a dashboard summary period."""

    product_id = serializers.IntegerField(allow_null=True)
    product_name = serializers.CharField()
    image_url = serializers.CharField(allow_null=True)
    quantity_total = serializers.IntegerField()
    revenue_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )


class PaymentMethodBreakdownSerializer(serializers.Serializer):
    """Revenue share for a single payment method within the period."""

    payment_method = serializers.CharField()
    revenue_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    orders_count = serializers.IntegerField()


class StatusBreakdownSerializer(serializers.Serializer):
    """Order count for a single operational status within the period."""

    status = serializers.CharField()
    orders_count = serializers.IntegerField()


class RegionBreakdownSerializer(serializers.Serializer):
    """Revenue share for a single delivery region (or pickup) within the period."""

    region = serializers.CharField()
    revenue_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    orders_count = serializers.IntegerField()


class ChannelBreakdownSerializer(serializers.Serializer):
    """Revenue share for a single sales channel (virtual vs. loja física) within the period.

    Etapa 5 of the QR-code stock-exit evolution: turns SaleOrder.channel
    (Etapa 3) into the same kind of dashboard insight by_payment_method
    already gives for payment methods.
    """

    channel = serializers.CharField()
    revenue_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    orders_count = serializers.IntegerField()


class SaleOrderBreakdownSerializer(serializers.Serializer):
    """Sales breakdown by product, payment method, region, status and channel for the dashboard."""

    period = serializers.CharField()
    top_products = TopProductBreakdownSerializer(many=True)
    by_payment_method = PaymentMethodBreakdownSerializer(many=True)
    by_status = StatusBreakdownSerializer(many=True)
    by_region = RegionBreakdownSerializer(many=True)
    by_channel = ChannelBreakdownSerializer(many=True)


class SaleOrderCustomerInsightsSerializer(serializers.Serializer):
    """Bot-to-sale conversion and new-vs-returning customer mix for the dashboard."""

    period = serializers.CharField()
    new_customers = serializers.IntegerField()
    returning_customers = serializers.IntegerField()
    bot_conversations_count = serializers.IntegerField()
    bot_converted_count = serializers.IntegerField()
    bot_conversion_rate = serializers.DecimalField(
        max_digits=6, decimal_places=2, allow_null=True
    )


class RegisterUserSerializer(serializers.Serializer):
    """Register a new active user account with password validation.

    Etapa 4 of the multi-tenant evolution: registration also creates the
    user's first Store and an owner StoreMembership, so a self-registered
    account can use the dashboard without an operator manually assigning a
    Django group first.
    """

    CONTEXT_DASHBOARD_OWNER = "dashboard_owner"
    CONTEXT_STOREFRONT_CUSTOMER = "storefront_customer"
    CONTEXT_CHOICES = (
        (CONTEXT_DASHBOARD_OWNER, "Dashboard owner"),
        (CONTEXT_STOREFRONT_CUSTOMER, "Storefront customer"),
    )

    email = serializers.EmailField()
    password = serializers.CharField(
        write_only=True, min_length=8, trim_whitespace=False
    )
    confirm_password = serializers.CharField(
        write_only=True, min_length=8, trim_whitespace=False
    )
    registration_context = serializers.ChoiceField(
        choices=CONTEXT_CHOICES,
        required=False,
        default=CONTEXT_DASHBOARD_OWNER,
    )
    store_name = serializers.CharField(
        max_length=120, trim_whitespace=True, required=False
    )
    store_slug = serializers.SlugField(required=False)
    full_name = serializers.CharField(
        max_length=160, trim_whitespace=True, required=False, allow_blank=True
    )
    phone = serializers.CharField(
        max_length=32, trim_whitespace=True, required=False, allow_blank=True
    )
    # Optional at registration for every context; only required for
    # storefront_customer (validated below), and even then only full_name
    # and phone -- address stays optional here the same way it always was
    # optional in the pre-profile checkout form (only required later, at
    # checkout time, if the customer picks delivery over pickup).
    address = serializers.CharField(
        max_length=255, trim_whitespace=True, required=False, allow_blank=True
    )
    neighborhood = serializers.CharField(
        max_length=255, trim_whitespace=True, required=False, allow_blank=True
    )
    city = serializers.CharField(
        max_length=255, trim_whitespace=True, required=False, allow_blank=True
    )

    def validate_store_name(self, value: str) -> str:
        normalized_name = value.strip()
        if not normalized_name:
            raise serializers.ValidationError("Informe o nome da sua loja.")
        return normalized_name

    def validate_email(self, value: str) -> str:
        normalized_email = value.strip().lower()
        if User.objects.filter(email__iexact=normalized_email).exists():
            raise serializers.ValidationError(
                "Ja existe uma conta cadastrada com este email."
            )
        return normalized_email

    def validate(self, attrs):
        attrs = super().validate(attrs)

        password = attrs.get("password", "")
        confirm_password = attrs.get("confirm_password", "")

        if password != confirm_password:
            raise serializers.ValidationError(
                {"confirm_password": "As senhas informadas nao coincidem."}
            )

        preview_user = User(
            username=attrs.get("email", ""),
            email=attrs.get("email", ""),
        )

        try:
            validate_password(password, user=preview_user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(
                {"password": list(error.messages)}
            ) from error

        context = attrs.get("registration_context", self.CONTEXT_DASHBOARD_OWNER)

        if context == self.CONTEXT_DASHBOARD_OWNER:
            store_name = (attrs.get("store_name") or "").strip()
            if not store_name:
                raise serializers.ValidationError(
                    {"store_name": "Informe o nome da sua loja."}
                )
            attrs["store_name"] = store_name

        if context == self.CONTEXT_STOREFRONT_CUSTOMER:
            store_slug = (attrs.get("store_slug") or "").strip().lower()
            if not store_slug:
                raise serializers.ValidationError(
                    {"store_slug": "Informe a loja para criar o perfil de cliente."}
                )

            store = Store.objects.filter(slug=store_slug, is_active=True).first()
            if store is None:
                raise serializers.ValidationError(
                    {"store_slug": "Loja nao encontrada ou inativa."}
                )

            attrs["store_slug"] = store_slug
            attrs["resolved_store"] = store

            full_name = (attrs.get("full_name") or "").strip()
            if not full_name:
                raise serializers.ValidationError({"full_name": "Informe seu nome."})
            attrs["full_name"] = full_name

            phone = (attrs.get("phone") or "").strip()
            if not phone:
                raise serializers.ValidationError({"phone": "Informe seu WhatsApp."})
            attrs["phone"] = phone

        return attrs

    def create(self, validated_data):
        email = validated_data["email"]
        password = validated_data["password"]
        context = validated_data.get(
            "registration_context", self.CONTEXT_DASHBOARD_OWNER
        )

        with transaction.atomic():
            user = User.objects.create_user(
                username=email,
                email=email,
                password=password,
                is_active=True,
            )

            full_name = str(validated_data.get("full_name") or "").strip()
            if full_name:
                parts = full_name.split(maxsplit=1)
                user.first_name = parts[0]
                user.last_name = parts[1] if len(parts) > 1 else ""
                user.save(update_fields=["first_name", "last_name"])

            if context == self.CONTEXT_DASHBOARD_OWNER:
                store_name = validated_data["store_name"]
                Store.create_for_owner(name=store_name, owner=user)
            else:
                store = validated_data["resolved_store"]
                CustomerProfile.objects.create(
                    user=user,
                    store=store,
                    full_name=full_name,
                    phone=str(validated_data.get("phone") or "").strip(),
                    address=str(validated_data.get("address") or "").strip(),
                    neighborhood=str(validated_data.get("neighborhood") or "").strip(),
                    city=str(validated_data.get("city") or "").strip(),
                )

        return user


class CustomerProfileSerializer(serializers.Serializer):
    """Read/update a storefront customer's own profile (identity + address).

    Etapa 0 of docs/architecture/customer-profile-checkout-evolution.md:
    `RegisterUserSerializer` already creates this row via the
    `storefront_customer` context; this is the only place it can be read
    back or edited afterwards. `delivery_region_id` is resolved against
    `context["store"]` the same way CheckoutWhatsAppView resolves it for an
    order -- the view must pass the resolved store in. No `email` field:
    the account's own (mandatory, unique) `user.email` already serves as
    the checkout contact email.
    """

    # No allow_blank on full_name/phone: required=False lets a PATCH omit
    # them entirely (partial update), but if the client DOES send one, DRF
    # rejects an empty string outright -- these are core identity fields
    # CheckoutWhatsAppView trusts unconditionally when building an order,
    # so they must never be saved blank (see docs/architecture/customer-
    # profile-checkout-evolution.md).
    full_name = serializers.CharField(max_length=160, required=False)
    phone = serializers.CharField(max_length=32, required=False)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    neighborhood = serializers.CharField(
        max_length=255, required=False, allow_blank=True
    )
    city = serializers.CharField(max_length=255, required=False, allow_blank=True)
    delivery_region_id = serializers.IntegerField(required=False, allow_null=True)
    delivery_region_name = serializers.SerializerMethodField(read_only=True)
    email = serializers.SerializerMethodField(read_only=True)

    def get_delivery_region_name(self, instance: "CustomerProfile") -> str:
        return instance.delivery_region.name if instance.delivery_region_id else ""

    def get_email(self, instance: "CustomerProfile") -> str:
        return instance.user.email

    def validate_delivery_region_id(self, value):
        if value is None:
            return value

        store = self.context["store"]
        if not DeliveryRegion.objects.filter(
            id=value, store=store, is_active=True
        ).exists():
            raise serializers.ValidationError("Selected delivery region is unavailable")
        return value

    def update(self, instance: "CustomerProfile", validated_data):
        for field_name in ("full_name", "phone", "address", "neighborhood", "city"):
            if field_name in validated_data:
                setattr(instance, field_name, validated_data[field_name].strip())

        if "delivery_region_id" in validated_data:
            instance.delivery_region_id = validated_data["delivery_region_id"]

        instance.save()
        return instance


class PasswordResetRequestSerializer(serializers.Serializer):
    """Validate a password reset request without exposing whether the email exists."""

    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Validate a reset token and set a new password for the related user."""

    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(
        write_only=True, min_length=8, trim_whitespace=False
    )
    confirm_password = serializers.CharField(
        write_only=True, min_length=8, trim_whitespace=False
    )

    default_error_messages = {
        "invalid_link": "O link de recuperacao e invalido ou expirou.",
    }

    def validate(self, attrs):
        attrs = super().validate(attrs)

        uid = attrs.get("uid", "").strip()
        token = attrs.get("token", "").strip()
        password = attrs.get("password", "")
        confirm_password = attrs.get("confirm_password", "")

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            raise serializers.ValidationError(
                {"uid": self.error_messages["invalid_link"]}
            )

        if not default_token_generator.check_token(user, token):
            raise serializers.ValidationError(
                {"token": self.error_messages["invalid_link"]}
            )

        if password != confirm_password:
            raise serializers.ValidationError(
                {"confirm_password": "As senhas informadas nao coincidem."}
            )

        try:
            validate_password(password, user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(
                {"password": list(error.messages)}
            ) from error

        attrs["user"] = user
        return attrs

    @staticmethod
    def build_reset_payload(user) -> dict[str, str]:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        return {"uid": uid, "token": token}
