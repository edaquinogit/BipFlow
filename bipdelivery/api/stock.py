"""Single chokepoint for manual stock_quantity mutations (Etapa 1 of the
stock-movement evolution, see docs/architecture/stock-movement-evolution.md).

Locks the product row, validates the resulting stock can never go negative,
and writes the Product update and its StockMovement audit row in the same
transaction. Checkout's bulk decrement path does NOT go through this
function -- see CheckoutWhatsAppView._reserve_cart_stock, which already
locks/decrements in bulk for its own hot path and only reuses StockMovement
as a plain bulk_create afterwards -- but every other stock_quantity write
should call apply_stock_movement().
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import Product, ProductVariant, SaleOrder, StockMovement, Store
from .payments import settle_payment_for_cancelled_order


class StockMovementError(Exception):
    """Raised when a manual stock movement would be invalid (e.g. negative stock)."""


def apply_stock_movement(
    *,
    product_id: int,
    store: Store,
    movement_type: str,
    quantity: int,
    reason: str,
    variant_id: int | None = None,
    performed_by=None,
    notes: str = "",
    source: str = StockMovement.SOURCE_MANUAL,
    sale_order=None,
) -> StockMovement:
    """Atomically adjust a product's stock and record the movement.

    Raises StockMovementError for invalid input (unknown product, zero/negative
    quantity, unknown movement_type, or a "saida" that would drive stock below
    zero). Callers translate that into their own error-response shape.
    """
    if quantity <= 0:
        raise StockMovementError("A quantidade deve ser maior que zero.")

    if movement_type not in (StockMovement.TYPE_ENTRADA, StockMovement.TYPE_SAIDA):
        raise StockMovementError("Tipo de movimento inválido.")

    with transaction.atomic():
        try:
            product = Product.objects.select_for_update().get(
                id=product_id, store=store
            )
        except Product.DoesNotExist as exc:
            raise StockMovementError("Produto não encontrado.") from exc

        selected_variant = None
        if variant_id is not None:
            try:
                selected_variant = ProductVariant.objects.select_for_update().get(
                    id=variant_id,
                    product=product,
                )
            except ProductVariant.DoesNotExist as exc:
                raise StockMovementError(
                    "Variante nao encontrada para este produto."
                ) from exc

        active_variants = list(
            ProductVariant.objects.select_for_update()
            .filter(product=product, is_active=True)
            .order_by("id")
        )
        if active_variants and selected_variant is None:
            raise StockMovementError(
                "Este produto possui variantes ativas. Informe a variante para movimentar o estoque."
            )

        stock_target = selected_variant or product
        previous_stock = stock_target.stock_quantity

        if movement_type == StockMovement.TYPE_ENTRADA:
            new_stock = previous_stock + quantity
        else:
            new_stock = previous_stock - quantity
            if new_stock < 0:
                raise StockMovementError(
                    f"Estoque insuficiente. Disponível: {previous_stock}, solicitado: {quantity}."
                )

        timestamp = timezone.now()

        if selected_variant is not None:
            selected_variant.stock_quantity = new_stock
            selected_variant.updated_at = timestamp
            selected_variant.save(update_fields=["stock_quantity", "updated_at"])

            if active_variants:
                for variant in active_variants:
                    if variant.id == selected_variant.id:
                        variant.stock_quantity = selected_variant.stock_quantity
                sync_product_stock_from_variants(
                    product,
                    variants=active_variants,
                    timestamp=timestamp,
                )
        else:
            product.stock_quantity = new_stock
            product.is_available = new_stock > 0
            product.updated_at = timestamp
            product.save(update_fields=["stock_quantity", "is_available", "updated_at"])

        return StockMovement.objects.create(
            store=store,
            product=product,
            variant=selected_variant,
            movement_type=movement_type,
            quantity=quantity,
            previous_stock=previous_stock,
            new_stock=new_stock,
            reason=reason,
            source=source,
            sale_order=sale_order,
            performed_by=performed_by,
            notes=notes,
        )


def sync_product_stock_from_variants(
    product: Product,
    *,
    variants: list[ProductVariant] | None = None,
    timestamp=None,
) -> int:
    """Sync a product's aggregate saleable stock from its active variants."""
    if variants is None:
        variants = list(product.variants.filter(is_active=True))
    else:
        variants = [variant for variant in variants if variant.is_active]

    if not variants:
        return product.stock_quantity

    aggregate_stock = sum(variant.stock_quantity for variant in variants)
    product.stock_quantity = aggregate_stock
    product.is_available = aggregate_stock > 0
    product.updated_at = timestamp or timezone.now()
    product.save(update_fields=["stock_quantity", "is_available", "updated_at"])
    return aggregate_stock


def apply_order_cancellation(
    *, order: SaleOrder, store: Store, performed_by=None
) -> list[StockMovement]:
    """Cancel `order` and restock every item it originally decremented.

    Etapa R2 of the QR-code stock-exit refinement (see
    docs/architecture/qrcode-stock-exit-refinement.md): cancelling a sale
    never used to touch stock at all, in either channel -- a WhatsApp order
    rarely gets cancelled after the fact, but a PDV sale can, every day, from
    an ordinary cashier mistake (wrong item, double-tap on "finalizar"). This
    is deliberately channel-agnostic: it restocks a cancelled order the same
    way regardless of whether it came from the storefront or the PDV,
    because there is no real business reason for the two channels to behave
    differently here.

    Idempotent: cancelling an already-cancelled order is a no-op (returns an
    empty list) instead of restocking twice. The order row is re-read under
    ``select_for_update`` at the top of the transaction and the "already
    cancelled" check repeated there, so two concurrent cancel requests can
    never both restock (the loser serialises on the lock, then sees
    ``STATUS_CANCELLED`` and bails). Locks every affected product row
    (ordered by id, same deadlock-free pattern as
    CheckoutWhatsAppView._lock_cart_products and PdvSaleView._lock_products)
    before mutating any of them.

    Everything past the lock reads the *locked* row, never the instance the
    caller passed in: a concurrent payment confirmation can move
    ``payment_status`` between the caller's read and this lock, and the
    financial settlement must branch on the committed value (a stale
    ``pending`` seen while the row is really ``paid`` would drive the
    settlement into an invalid ``paid -> cancelled`` transition). The caller's
    instance is refreshed from the database before returning so callers that
    serialise it straight after still see the committed state.
    """
    if order.status == SaleOrder.STATUS_CANCELLED:
        return []

    caller_order = order

    with transaction.atomic():
        # Serialise concurrent cancels on the order row before touching any
        # stock: without this, two near-simultaneous requests both pass the
        # pre-transaction check above and each restock the same items once
        # (and the payment settlement would run twice). Lock order first,
        # then products -- no other path locks products then this order.
        # From here on `order` IS the locked row -- the only source of truth
        # for the order's status/payment_status/channel/tenant.
        order = SaleOrder.objects.select_for_update().get(pk=order.pk)
        if order.status == SaleOrder.STATUS_CANCELLED:
            caller_order.refresh_from_db()
            return []

        items = list(order.items.all())
        product_ids = sorted({item.product_id for item in items if item.product_id})
        variant_ids = sorted({item.variant_id for item in items if item.variant_id})
        products_by_id = {
            product.id: product
            for product in Product.objects.select_for_update()
            .filter(id__in=product_ids, store=store)
            .order_by("id")
        }
        variants_by_id = {
            variant.id: variant
            for variant in ProductVariant.objects.select_for_update()
            .filter(id__in=variant_ids, product__store=store)
            .order_by("id")
        }

        timestamp = timezone.now()
        source = (
            StockMovement.SOURCE_PDV
            if order.channel == SaleOrder.CHANNEL_LOJA_FISICA
            else StockMovement.SOURCE_VENDA
        )
        movements = []

        for item in items:
            product = products_by_id.get(item.product_id)
            if product is None:
                # The product was deleted since the sale; nothing left to
                # restock for this line, but the rest of the order still
                # gets cancelled and restocked normally.
                continue

            variant = variants_by_id.get(item.variant_id)
            previous_stock = (
                variant.stock_quantity
                if variant is not None
                else product.stock_quantity
            )
            product.stock_quantity += item.quantity
            product.is_available = product.stock_quantity > 0
            product.updated_at = timestamp

            if variant is not None:
                variant.stock_quantity += item.quantity
                variant.updated_at = timestamp
            new_stock = (
                variant.stock_quantity
                if variant is not None
                else product.stock_quantity
            )

            movements.append(
                StockMovement(
                    store=store,
                    product=product,
                    variant=variant,
                    movement_type=StockMovement.TYPE_ENTRADA,
                    quantity=item.quantity,
                    previous_stock=previous_stock,
                    new_stock=new_stock,
                    reason=StockMovement.REASON_VENDA_CANCELADA,
                    source=source,
                    sale_order=order,
                    performed_by=performed_by,
                )
            )

        if products_by_id:
            Product.objects.bulk_update(
                list(products_by_id.values()),
                ["stock_quantity", "is_available", "updated_at"],
            )

        if variants_by_id:
            ProductVariant.objects.bulk_update(
                list(variants_by_id.values()), ["stock_quantity", "updated_at"]
            )

        if movements:
            StockMovement.objects.bulk_create(movements)

        order.status = SaleOrder.STATUS_CANCELLED
        order.save(update_fields=["status", "updated_at"])

        # Settle the payment side in the same transaction: a pending/failed
        # payment becomes `cancelled`, a paid one opens a `refund_pending`
        # (online-sales foundation). Branches on the locked row's current
        # payment_status, so a payment confirmed concurrently is handled as
        # `paid -> refund_pending`, not mis-driven into an invalid transition.
        # Never marks a real refund as done.
        settle_payment_for_cancelled_order(
            order, performed_by=performed_by, now=timestamp
        )

    # Reflect the committed cancellation (status + settled payment fields) on
    # the instance the caller handed us -- it may have come in stale and is
    # typically serialised straight after this call returns.
    caller_order.refresh_from_db()
    return movements
