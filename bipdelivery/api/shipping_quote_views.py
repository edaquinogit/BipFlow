"""Public storefront quote preview, gated per tenant; never creates orders."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Store, StoreShippingSettings
from .shipping_quotes import ShippingQuoteError, simulate_shipping
from .throttling import CheckoutIpThrottle


class ShippingQuoteView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [CheckoutIpThrottle]

    def post(self, request, slug):
        store = Store.objects.filter(slug=slug, is_active=True).first()
        if store is None or not StoreShippingSettings.objects.filter(
            store=store, national_shipping_enabled=True
        ).exists():
            return Response({"detail": "Cotacao nacional indisponivel."},
                            status=status.HTTP_404_NOT_FOUND)
        if not isinstance(request.data, dict):
            return Response({"detail": "Dados invalidos."}, status=400)
        if set(request.data) != {"destination_postal_code", "items"}:
            return Response({"detail": "Informe apenas CEP e itens."}, status=400)
        items = request.data["items"]
        if not isinstance(items, list) or any(
            not isinstance(item, dict) or set(item) != {"product_id", "quantity"}
            for item in items
        ):
            return Response({"detail": "Itens invalidos."}, status=400)
        try:
            parcel, quotes = simulate_shipping(
                store=store, items=items,
                destination=request.data["destination_postal_code"],
            )
        except ShippingQuoteError:
            return Response({"detail": "Nao foi possivel simular o frete. Confira CEP e dados logisticos."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "simulated": True,
            "order_confirmation_available": False,
            "quotes": [
                {"service": quote.service, "price": str(quote.price),
                 "estimated_days": quote.estimated_days,
                 "provider": quote.provider, "notice": quote.notice}
                for quote in quotes
            ],
        })
