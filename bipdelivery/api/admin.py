from django import forms
from django.contrib import admin
from django.core.exceptions import PermissionDenied

from . import admin_auth  # noqa: F401  -- installs the MFA-gated admin login form
from .models import (
    BotConversation,
    BotMessage,
    Category,
    CustomerFeedback,
    CustomerProfile,
    DeliveryRegion,
    LabelSettings,
    LoginAttempt,
    MerchantProfile,
    MFABackupCode,
    Product,
    ProductVariant,
    SaleOrder,
    SaleOrderItem,
    Store,
    StorefrontAppearance,
    StorefrontBanner,
    StoreMembership,
    StoreSettings,
    TOTPDevice,
)


class StoreScopedAdminMixin:
    """Restrict a store-scoped model's admin to the staff member's own stores (Etapa 4).

    Superusers keep full cross-tenant visibility (administrative override,
    consistent with how permissions.py already treats them); other staff
    only see rows belonging to a store they hold a StoreMembership in.
    """

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if request.user.is_superuser:
            return queryset
        return queryset.filter(store__memberships__user=request.user).distinct()

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "store" and not request.user.is_superuser:
            queryset = kwargs.get("queryset") or Store.objects.all()
            kwargs["queryset"] = queryset.filter(
                memberships__user=request.user
            ).distinct()
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def _assign_default_store_for_staff(self, request, obj) -> None:
        if obj.store_id or request.user.is_superuser:
            return

        membership = (
            StoreMembership.objects.filter(user=request.user)
            .select_related("store")
            .order_by("store_id", "id")
            .first()
        )
        if membership is not None:
            obj.store = membership.store

    def _validate_store_membership_for_save(self, request, obj, change) -> None:
        if request.user.is_superuser:
            return

        if not obj.store_id:
            raise PermissionDenied("Voce nao possui acesso a esta loja.")

        membership_store_ids = set(
            StoreMembership.objects.filter(user=request.user).values_list(
                "store_id", flat=True
            )
        )
        if change and obj.pk:
            original_store_id = (
                obj.__class__._default_manager.filter(pk=obj.pk)
                .values_list("store_id", flat=True)
                .first()
            )
            if original_store_id not in membership_store_ids:
                raise PermissionDenied("Voce nao possui acesso a esta loja.")

        if not StoreMembership.objects.filter(
            user=request.user, store_id=obj.store_id
        ).exists():
            raise PermissionDenied("Voce nao possui acesso a esta loja.")

    def save_model(self, request, obj, form, change):
        self._assign_default_store_for_staff(request, obj)
        self._validate_store_membership_for_save(request, obj, change)
        super().save_model(request, obj, form, change)


class StoreScopedCategoryParentFilter(admin.SimpleListFilter):
    title = "parent"
    parameter_name = "parent"

    def lookups(self, request, model_admin):
        queryset = Category.objects.filter(parent__isnull=True)
        if not request.user.is_superuser:
            queryset = queryset.filter(store__memberships__user=request.user)

        lookups = [("__none__", "-")]
        lookups.extend(
            (str(category.id), category.name)
            for category in queryset.distinct().order_by("name", "id")
        )
        return lookups

    def queryset(self, request, queryset):
        value = self.value()
        if value == "__none__":
            return queryset.filter(parent__isnull=True)

        if value:
            return queryset.filter(parent_id=value)

        return queryset


@admin.register(Category)
class CategoryAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = ("id", "name", "parent", "store")
    list_filter = ("store", StoreScopedCategoryParentFilter)
    search_fields = ("name", "description", "parent__name")


class ProductVariantInline(admin.TabularInline):
    model = ProductVariant
    extra = 0
    fields = ("name", "color_hex", "price", "stock_quantity", "image", "is_active", "position")


@admin.register(Product)
class ProductAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = ("name", "store", "category", "price", "is_available")
    list_filter = ("store", "category", "is_available")
    search_fields = ("name", "description")
    inlines = [ProductVariantInline]


@admin.register(DeliveryRegion)
class DeliveryRegionAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = ("name", "store", "city", "delivery_fee", "is_active")
    list_filter = ("store", "is_active", "city")
    search_fields = ("name", "city", "neighborhoods")


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "slug", "tagline", "is_active", "owner")
    list_filter = ("is_active",)
    search_fields = ("name", "slug")

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if request.user.is_superuser:
            return queryset
        return queryset.filter(memberships__user=request.user).distinct()


@admin.register(StoreMembership)
class StoreMembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "store", "user", "role")
    list_filter = ("role", "store")
    search_fields = ("user__username", "user__email")


@admin.register(LabelSettings)
class LabelSettingsAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = (
        "id",
        "store",
        "page_format",
        "columns",
        "rows",
        "qr_size_mm",
        "updated_at",
    )
    list_filter = ("page_format", "store")
    readonly_fields = ("created_at", "updated_at")


class MerchantProfileAdminForm(forms.ModelForm):
    """Admin form that accepts common masks before model-level normalization."""

    tax_id = forms.CharField(required=False, max_length=32)
    contact_phone = forms.CharField(required=False, max_length=32)
    postal_code = forms.CharField(required=False, max_length=16)

    class Meta:
        model = MerchantProfile
        fields = "__all__"


@admin.register(MerchantProfile)
class MerchantProfileAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    form = MerchantProfileAdminForm
    list_display = ("id", "store", "trade_name", "city", "state", "updated_at")
    list_filter = ("state", "country")
    search_fields = ("store__name", "legal_name", "trade_name", "tax_id")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StorefrontAppearance)
class StorefrontAppearanceAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = (
        "id",
        "store",
        "card_style",
        "radius_style",
        "hero_enabled",
        "motion_enabled",
        "decoration_style",
        "updated_at",
    )
    list_filter = ("card_style", "radius_style", "hero_enabled", "decoration_style")
    readonly_fields = ("created_at", "updated_at")


@admin.register(StorefrontBanner)
class StorefrontBannerAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = (
        "id",
        "store",
        "title",
        "position",
        "is_active",
        "status",
        "starts_at",
        "ends_at",
        "updated_at",
    )
    list_filter = ("is_active", "store", "destination_type")
    search_fields = ("title", "subtitle", "alt_text")
    readonly_fields = ("button_url", "created_at", "updated_at")


@admin.register(CustomerProfile)
class CustomerProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "store", "user", "full_name", "phone", "city")
    list_filter = ("store",)
    search_fields = ("user__username", "user__email", "full_name", "phone", "city")


@admin.register(StoreSettings)
class StoreSettingsAdmin(admin.ModelAdmin):
    list_display = ("id", "whatsapp_phone", "updated_at")
    readonly_fields = ("created_at", "updated_at")


@admin.register(LoginAttempt)
class LoginAttemptAdmin(admin.ModelAdmin):
    list_display = (
        "identifier",
        "succeeded",
        "failure_reason",
        "ip_address",
        "user",
        "created_at",
    )
    list_filter = ("succeeded", "failure_reason", "created_at")
    search_fields = ("identifier", "ip_address", "user__username", "user__email")
    readonly_fields = (
        "user",
        "identifier",
        "ip_address",
        "user_agent",
        "succeeded",
        "failure_reason",
        "store_id",
        "created_at",
    )

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False


@admin.register(TOTPDevice)
class TOTPDeviceAdmin(admin.ModelAdmin):
    list_display = ("user", "confirmed", "created_at", "confirmed_at")
    list_filter = ("confirmed",)
    search_fields = ("user__username", "user__email")
    readonly_fields = ("user", "confirmed", "created_at", "confirmed_at")
    # has_change_permission below makes every field read-only-rendered
    # regardless of readonly_fields, so the ciphertext would otherwise still
    # render on the detail page for any staff with view permission -- not
    # plaintext, but no reason to show it at all.
    exclude = ("encrypted_secret",)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False


@admin.register(MFABackupCode)
class MFABackupCodeAdmin(admin.ModelAdmin):
    list_display = ("user", "used_at", "created_at")
    list_filter = ("used_at",)
    search_fields = ("user__username", "user__email")
    readonly_fields = ("user", "used_at", "created_at")
    exclude = ("code_hash",)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False


class BotMessageInline(admin.TabularInline):
    model = BotMessage
    extra = 0
    readonly_fields = ("role", "content", "intent", "metadata", "created_at")
    can_delete = False


@admin.register(BotConversation)
class BotConversationAdmin(admin.ModelAdmin):
    list_display = ("session_id", "channel", "status", "last_intent", "updated_at")
    list_filter = ("channel", "status", "last_intent", "created_at")
    search_fields = ("session_id", "customer_phone", "messages__content")
    readonly_fields = ("session_id", "created_at", "updated_at")
    inlines = [BotMessageInline]


@admin.register(CustomerFeedback)
class CustomerFeedbackAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    """Operational fallback for triaging storefront feedback before/without
    the dashboard's own Feedbacks page."""

    list_display = ("store", "feedback_type", "status", "created_at")
    list_filter = ("store", "feedback_type", "status", "created_at")
    search_fields = ("message", "contact", "correlation_id")
    readonly_fields = (
        "store",
        "customer_profile",
        "feedback_type",
        "message",
        "contact",
        "page_path",
        "product",
        "order",
        "correlation_id",
        "user_agent",
        "created_at",
        "updated_at",
    )


class SaleOrderItemInline(admin.TabularInline):
    model = SaleOrderItem
    extra = 0
    readonly_fields = (
        "product",
        "variant",
        "product_name",
        "sku",
        "variant_name",
        "variant_color_hex",
        "variant_image_url",
        "quantity",
        "unit_price",
        "line_total",
    )
    can_delete = False


@admin.register(SaleOrder)
class SaleOrderAdmin(StoreScopedAdminMixin, admin.ModelAdmin):
    list_display = (
        "order_reference",
        "store",
        "customer_name",
        "total",
        "status",
        "created_at",
    )
    list_filter = ("store", "status", "delivery_method", "payment_method", "created_at")
    search_fields = (
        "order_reference",
        "customer_name",
        "customer_phone",
        "items__product_name",
    )
    readonly_fields = ("order_reference", "created_at", "updated_at")
    inlines = [SaleOrderItemInline]
