"""Internal, read-only shipping simulation. No carrier or checkout integration."""
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from typing import Protocol

from .models import Product, StoreShippingSettings


class ShippingQuoteError(ValueError):
    """Safe domain error; never exposes foreign tenant data."""


def postal_code(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{5}-?[0-9]{3}", value):
        raise ShippingQuoteError("CEP invalido.")
    return value.replace("-", "")


def number(value, minimum, maximum):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or not minimum <= result <= maximum:
            raise ValueError
    except (InvalidOperation, TypeError, ValueError):
        raise ShippingQuoteError("Dados logisticos invalidos.") from None
    return result


def integer(value, minimum, maximum):
    result = number(value, minimum, maximum)
    if result != result.to_integral_value():
        raise ShippingQuoteError("Quantidade ou peso invalido.")
    return int(result)


def dimensions(row):
    return tuple(sorted((number(row.get(key), Decimal("0.01"), 100000)
                         for key in ("length_cm", "width_cm", "height_cm")), reverse=True))


@dataclass(frozen=True)
class Parcel:
    name: str
    dimensions_cm: tuple[Decimal, Decimal, Decimal]
    weight_grams: int

    @property
    def volume_cm3(self):
        a, b, c = self.dimensions_cm
        return a * b * c


@dataclass(frozen=True)
class Rate:
    service: str
    base_price: Decimal
    per_kg: Decimal
    per_zone: Decimal
    base_days: int


@dataclass(frozen=True)
class Quote:
    service: str
    price: Decimal
    estimated_days: int
    billable_grams: int
    provider: str = "simulated"
    notice: str = "Simulacao: nao representa tarifa ou prazo oficial dos Correios."


class QuoteProvider(Protocol):
    def quote(self, origin: str, destination: str, parcel: Parcel) -> tuple[Quote, ...]: ...


@dataclass(frozen=True)
class SimulatedProvider:
    # Explicit illustrative defaults, replaceable by trusted server configuration.
    rates: tuple[Rate, ...] = (
        Rate("economico_simulado", Decimal("12"), Decimal("4"), Decimal("3"), 4),
        Rate("expresso_simulado", Decimal("20"), Decimal("7"), Decimal("5"), 2),
    )
    volumetric_divisor: int = 6000

    def quote(self, origin, destination, parcel):
        origin, destination = postal_code(origin), postal_code(destination)
        # CEP prefix difference is a synthetic zone, not geographic distance.
        zone = min(4, abs(int(origin[0]) - int(destination[0])))
        divisor = integer(self.volumetric_divisor, 1, 1000000)
        cubic = int((parcel.volume_cm3 * 1000 / divisor).to_integral_value(
            rounding=ROUND_CEILING))
        billable = max(parcel.weight_grams, cubic)
        kg = (Decimal(billable) / 1000).to_integral_value(rounding=ROUND_CEILING)
        return tuple(Quote(
            rate.service,
            (number(rate.base_price, 0, 100000) + kg * number(rate.per_kg, 0, 100000)
             + zone * number(rate.per_zone, 0, 100000)).quantize(Decimal("0.01")),
            integer(rate.base_days, 1, 365) + zone,
            billable,
        ) for rate in self.rates)


def simulate_shipping(*, store, items, destination, provider=None):
    """Trusted internal caller supplies resolved store; no public endpoint.

    Stack items on their largest face, choose smallest fitting configured box.
    No multi-parcel packing; reject carts that cannot fit a single box.
    """
    destination = postal_code(destination)
    if not store.pk:
        raise ShippingQuoteError("Loja invalida.")
    settings = StoreShippingSettings.objects.filter(store_id=store.pk).first()
    if settings is None:
        raise ShippingQuoteError("Configuracao logistica ausente.")
    origin = postal_code(settings.origin_postal_code)
    if not isinstance(items, (list, tuple)) or not 1 <= len(items) <= 100:
        raise ShippingQuoteError("Carrinho invalido.")
    quantities = {}
    for item in items:
        if not isinstance(item, dict):
            raise ShippingQuoteError("Item invalido.")
        pk = integer(item.get("product_id"), 1, 9223372036854775807)
        qty = integer(item.get("quantity"), 1, 100)
        quantities[pk] = quantities.get(pk, 0) + qty
    if sum(quantities.values()) > 100:
        raise ShippingQuoteError("Limite de itens excedido.")
    products = Product.objects.filter(store_id=store.pk, pk__in=quantities)
    if len(products) != len(quantities):
        raise ShippingQuoteError("Produto indisponivel para esta loja.")
    length = width = height = Decimal(0)
    weight = integer(settings.packaging_weight_grams, 0, 10000000)
    for product in products:
        qty = quantities[product.pk]
        a, b, c = dimensions({key: getattr(product, key) for key in
                              ("length_cm", "width_cm", "height_cm")})
        length, width, height = max(length, a), max(width, b), height + c * qty
        weight += integer(product.weight_grams, 1, 10000000) * qty
    required = sorted((length, width, height), reverse=True)
    candidates = []
    if not isinstance(settings.package_options, list) or len(settings.package_options) > 20:
        raise ShippingQuoteError("Embalagens invalidas.")
    for option in settings.package_options:
        if not isinstance(option, dict) or not isinstance(option.get("name"), str):
            raise ShippingQuoteError("Embalagem invalida.")
        dims = dimensions(option)
        tare = integer(option.get("tare_weight_grams", 0), 0, 10000000)
        if all(a <= b for a, b in zip(required, dims)):
            candidates.append(Parcel(option["name"], dims, weight + tare))
    if not candidates:
        raise ShippingQuoteError("Nenhuma embalagem comporta o carrinho.")
    parcel = min(candidates, key=lambda p: (p.volume_cm3, p.weight_grams, p.name))
    return parcel, (provider or SimulatedProvider()).quote(origin, destination, parcel)
