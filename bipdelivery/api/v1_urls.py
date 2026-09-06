from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .pdv import PdvReceiptEmailView, PdvSaleView
from .views import (
    BotConversationViewSet,
    BotMessageView,
    CategoryViewSet,
    CheckoutWhatsAppView,
    CurrentStoreView,
    CustomerFeedbackCreateView,
    CustomerFeedbackViewSet,
    CustomerProfileView,
    DeliveryRegionViewSet,
    MerchantProfileView,
    MyStoreDetailView,
    MyStoresView,
    ProductViewSet,
    PublicStorefrontAppearanceView,
    PublicStorefrontBannerListView,
    PublicStoreSettingsView,
    SaleOrderViewSet,
    StockMovementViewSet,
    StoreAppearanceSettingsView,
    StorefrontBannerDetailView,
    StorefrontBannerListView,
    StorefrontBannerReorderView,
    StorefrontAppearanceView,
    StorefrontMediaUploadView,
    StoreLabelSettingsView,
    StoreReceiptSettingsView,
    StoreSettingsView,
)

# 🛰️ ROUTER CONFIGURATION
# Usamos o DefaultRouter para gerar automaticamente as rotas de CRUD
router = DefaultRouter()
router.register(r"products", ProductViewSet, basename="product")
router.register(r"categories", CategoryViewSet, basename="category")
router.register(r"delivery-regions", DeliveryRegionViewSet, basename="delivery-region")
router.register(r"sales-orders", SaleOrderViewSet, basename="sales-order")
router.register(r"bot-conversations", BotConversationViewSet, basename="bot-conversation")
router.register(r"stock-movements", StockMovementViewSet, basename="stock-movement")
router.register(r"feedback-reports", CustomerFeedbackViewSet, basename="feedback-report")

urlpatterns = [
    # Injeta todas as rotas geradas pelo roteador
    path("bot/messages/", BotMessageView.as_view(), name="bot-message"),
    path("checkout/whatsapp/", CheckoutWhatsAppView.as_view(), name="checkout-whatsapp"),
    path("feedback/", CustomerFeedbackCreateView.as_view(), name="customer-feedback-create"),
    path("customers/me/", CustomerProfileView.as_view(), name="customer-profile-me"),
    path("pdv/sales/", PdvSaleView.as_view(), name="pdv-sale"),
    path(
        "pdv/sales/<str:order_reference>/receipt-email/",
        PdvReceiptEmailView.as_view(),
        name="pdv-sale-receipt-email",
    ),
    path("store/current/", CurrentStoreView.as_view(), name="store-current"),
    path(
        "store/current/merchant-profile/",
        MerchantProfileView.as_view(),
        name="store-current-merchant-profile",
    ),
    path(
        "store/current/appearance/",
        StoreAppearanceSettingsView.as_view(),
        name="store-current-appearance",
    ),
    path(
        "store/current/storefront-appearance/",
        StorefrontAppearanceView.as_view(),
        name="store-current-storefront-appearance",
    ),
    path(
        "store/current/storefront-media/",
        StorefrontMediaUploadView.as_view(),
        name="store-current-storefront-media",
    ),
    path(
        "store/current/storefront-banners/",
        StorefrontBannerListView.as_view(),
        name="store-current-storefront-banners",
    ),
    path(
        "store/current/storefront-banners/reorder/",
        StorefrontBannerReorderView.as_view(),
        name="store-current-storefront-banners-reorder",
    ),
    path(
        "store/current/storefront-banners/<int:banner_id>/",
        StorefrontBannerDetailView.as_view(),
        name="store-current-storefront-banner-detail",
    ),
    path("store/mine/", MyStoresView.as_view(), name="store-mine"),
    path("store/mine/<slug:slug>/", MyStoreDetailView.as_view(), name="store-mine-detail"),
    path(
        "store/mine/<slug:slug>/appearance/",
        StoreAppearanceSettingsView.as_view(),
        name="store-mine-appearance",
    ),
    path(
        "store/mine/<slug:slug>/storefront-appearance/",
        StorefrontAppearanceView.as_view(),
        name="store-mine-storefront-appearance",
    ),
    path(
        "public/stores/<slug:slug>/appearance/",
        PublicStorefrontAppearanceView.as_view(),
        name="public-store-storefront-appearance",
    ),
    path(
        "public/stores/<slug:slug>/banners/",
        PublicStorefrontBannerListView.as_view(),
        name="public-store-storefront-banners",
    ),
    path(
        "store/mine/<slug:slug>/label-settings/",
        StoreLabelSettingsView.as_view(),
        name="store-mine-label-settings",
    ),
    path(
        "store/mine/<slug:slug>/receipt-settings/",
        StoreReceiptSettingsView.as_view(),
        name="store-mine-receipt-settings",
    ),
    path("store-settings/public/", PublicStoreSettingsView.as_view(), name="public-store-settings"),
    path("store-settings/", StoreSettingsView.as_view(), name="store-settings"),
    path("", include(router.urls)),
]
