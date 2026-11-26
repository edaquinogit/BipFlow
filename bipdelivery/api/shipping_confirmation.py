"""Build a server-owned snapshot for a future national checkout."""
from .models import StoreShippingSettings
from .shipping_quotes import ShippingQuoteError, postal_code, simulate_shipping


def confirm_shipping(*, store, items, destination, service):
    """Call within the checkout transaction, using its resolved tenant."""
    config = StoreShippingSettings.objects.select_for_update().filter(
        store_id=store.pk, national_shipping_enabled=True
    ).first()
    if not store.is_active or config is None:
        raise ShippingQuoteError("Frete nacional indisponivel.")
    destination = postal_code(destination)
    parcel, quotes = simulate_shipping(
        store=store, items=items, destination=destination
    )
    selected = next((q for q in quotes if q.service == service), None)
    if selected is None:
        raise ShippingQuoteError("Modalidade indisponivel.")
    return selected.price, {
        "version": 1,
        "kind": "national_simulated",
        "provider": selected.provider,
        "service": selected.service,
        "price": str(selected.price),
        "estimated_days": selected.estimated_days,
        "origin_postal_code": postal_code(config.origin_postal_code),
        "destination_postal_code": destination,
        "parcel": {
            "name": parcel.name,
            "dimensions_cm": [str(d) for d in parcel.dimensions_cm],
            "weight_grams": parcel.weight_grams,
        },
        "notice": selected.notice,
    }
