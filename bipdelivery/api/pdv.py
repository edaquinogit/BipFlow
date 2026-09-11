"""Point-of-sale (PDV) checkout for the physical store (Etapa 3 of the
QR-code stock-exit evolution, see
docs/architecture/qrcode-stock-exit-evolution.md).

Kept in its own module rather than folded into the already-large views.py:
this is a self-contained vertical slice (its own input/output serializers,
its own stock-reservation logic, one view) that only needs to import shared
primitives from the rest of the app, not the other way around.

Distinct from CheckoutWhatsAppView (bipdelivery/api/views.py): that endpoint
is public/unauthenticated and resolves cart items by numeric product id for
the e-commerce/WhatsApp flow. This one is dashboard-authenticated, resolves
items by the `public_code` a cashier scans or types, and marks the resulting
SaleOrder with `channel=CHANNEL_LOJA_FISICA`. Both reuse the same shape of
atomic, lock-then-bulk-update stock reservation -- lock every affected
product row in one query ordered by id (deadlock-free), validate, decrement
in memory, and persist with a single bulk_update() plus a bulk_create() of
the StockMovement audit trail -- because a single sale can ring up several
different products in one transaction, so per-item locking (the single-item
apply_stock_movement() chokepoint used by the dashboard's manual
entrada/saida form) isn't the right fit here either.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import re
import time
from decimal import Decimal

from django.conf import settings
from django.core.mail import EmailMessage
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .errors import not_found_error
from .models import (
    PaymentStatusEvent,
    Product,
    ProductVariant,
    SaleOrder,
    SaleOrderItem,
    StockMovement,
    Store,
)
from .order_reference import build_sale_order_reference
from .payments import record_initial_payment_event
from .permissions import has_dashboard_write_access
from .store_scope import resolve_request_store
from .throttling import PdvReceiptEmailThrottle

logger = logging.getLogger(__name__)

DEFAULT_PDV_CUSTOMER_NAME = "Cliente balcão"

# Same character budget as the public checkout's idempotency key
# (CheckoutRequestSerializer.validate_idempotency_key): 8-128 chars of an
# opaque, URL-safe alphabet. The dashboard sends one fresh value per running
# cart, so a double-tapped "Finalizar venda", a retried request after a
# network blip, or a held-down Enter can never ring the same cart up twice.
IDEMPOTENCY_KEY_PATTERN = re.compile(r"[A-Za-z0-9:_-]{8,128}")

# PDV receipt PDF/email evolution: the PDF itself is built client-side (no
# server-side PDF library exists in this project, see utils/receiptPdf.ts)
# and posted here as base64 just to be relayed as an email attachment --
# these guard against an oversized or malformed payload.
MAX_RECEIPT_PDF_BYTES = 5 * 1024 * 1024
PDF_MAGIC_NUMBER = b"%PDF"


class PdvSaleItemInputSerializer(serializers.Serializer):
    """One scanned/typed line of the cashier's running cart."""

    public_code = serializers.CharField(max_length=12)
    variant_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class PdvSaleRequestSerializer(serializers.Serializer):
    """Validates the POST body for a physical-store sale.

    No delivery/address fields at all (unlike CheckoutRequestSerializer):
    a PDV sale is always picked up on the spot. customer_name is optional
    because most counter sales have no reason to collect one.
    """

    items = PdvSaleItemInputSerializer(many=True)
    payment_method = serializers.ChoiceField(choices=["pix", "card", "cash"])
    customer_name = serializers.CharField(
        required=False, allow_blank=True, max_length=255, default=""
    )
    # Optional (Etapa R4 of the QR-code stock-exit refinement): capturing it
    # lets a PDV sale feed the same new-vs-returning customer insight
    # (SaleOrderCustomerInsightsSerializer) the virtual channel already gets
    # for free from its required checkout phone -- today every PDV sale has
    # customer_phone="" and is silently excluded from that metric.
    customer_phone = serializers.CharField(
        required=False, allow_blank=True, max_length=32, default=""
    )
    # Optional (PDV receipt PDF/email evolution): SaleOrder.customer_email
    # already exists on the model (populated by the WhatsApp/checkout flow's
    # CheckoutCustomerInputSerializer.email) but the PDV never wrote to it --
    # capturing it here is what lets the cashier email the printed receipt.
    customer_email = serializers.EmailField(
        required=False, allow_blank=True, default=""
    )
    notes = serializers.CharField(
        required=False, allow_blank=True, max_length=1000, default=""
    )
    # Optional. When absent the endpoint behaves exactly as before; when
    # present, a repeat of the same cart under the same key returns the
    # original sale instead of ringing it up again (see PdvSaleView.post).
    idempotency_key = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=128,
        trim_whitespace=True,
    )

    def validate_items(self, value):
        """Ensure the cart has at least one item."""
        if not value:
            raise serializers.ValidationError(
                "Informe ao menos um item para registrar a venda."
            )
        return value

    def validate_idempotency_key(self, value: str) -> str:
        if not value:
            return ""
        if not IDEMPOTENCY_KEY_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                "A chave de idempotencia deve ter 8 a 128 caracteres seguros."
            )
        return value


class PdvSaleItemResponseSerializer(serializers.Serializer):
    """Normalized item details returned after a PDV sale completes."""

    product_id = serializers.IntegerField()
    variant_id = serializers.IntegerField(allow_null=True)
    product_name = serializers.CharField()
    variant_name = serializers.CharField(allow_blank=True)
    variant_color_hex = serializers.CharField(allow_blank=True)
    variant_image_url = serializers.CharField(allow_blank=True)
    public_code = serializers.CharField()
    quantity = serializers.IntegerField(min_value=1)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2)


class PdvSaleResponseSerializer(serializers.Serializer):
    """Serializer for the PDV sale confirmation response."""

    order_reference = serializers.CharField()
    items = PdvSaleItemResponseSerializer(many=True)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    payment_method = serializers.CharField()
    created_at = serializers.DateTimeField()
    # Receipt PDF/email evolution: lets the just-finalized receipt modal
    # pre-fill the "send by email" field without a fresh lookup.
    customer_email = serializers.CharField()


def build_pdv_idempotency_payload_hash(
    *, store: Store, validated: dict, performed_by_id: int | None
) -> str:
    """Canonical fingerprint of a PDV sale request.

    Two requests carrying the same idempotency key but a different cart (or
    a different cashier, or a different payment method) are a genuine
    conflict, not a retry -- this hash is what lets ``post()`` tell a safe
    replay apart from a key collision.
    """
    canonical = {
        "store_id": store.id,
        "performed_by_id": performed_by_id,
        "payment_method": validated["payment_method"],
        "items": sorted(
            [
                item["public_code"].strip().upper(),
                item.get("variant_id"),
                int(item["quantity"]),
            ]
            for item in validated["items"]
        ),
    }
    encoded = json.dumps(
        canonical, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def find_pdv_idempotent_order(
    *, store: Store, idempotency_key: str
) -> SaleOrder | None:
    """The existing PDV sale for this store + key, if one was already rung up."""
    if not idempotency_key:
        return None
    return (
        SaleOrder.objects.filter(store=store, idempotency_key=idempotency_key)
        .prefetch_related("items", "items__product")
        .first()
    )


def serialize_persisted_pdv_sale(sale_order: SaleOrder) -> dict:
    """Rebuild ``PdvSaleResponseSerializer``'s input from a stored SaleOrder,
    so an idempotent replay returns the same body the original create did."""
    items = [
        {
            "product_id": item.product_id,
            "variant_id": item.variant_id,
            "product_name": item.product_name,
            "variant_name": item.variant_name or "",
            "variant_color_hex": item.variant_color_hex or "",
            "variant_image_url": item.variant_image_url or "",
            "public_code": item.product.public_code if item.product_id else "",
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": item.line_total,
        }
        for item in sale_order.items.all()
    ]
    return {
        "order_reference": sale_order.order_reference,
        "items": items,
        "subtotal": sale_order.subtotal,
        "total": sale_order.total,
        "payment_method": sale_order.payment_method,
        "created_at": sale_order.created_at,
        "customer_email": sale_order.customer_email or "",
    }


class PdvSaleView(APIView):
    """POST /v1/pdv/sales/ -- ring up a physical-store sale by scanned code.

    Dashboard-only (has_dashboard_write_access), scoped to the requester's
    store via resolve_request_store(). Permission is checked inline (like
    SaleOrderViewSet.update_status) rather than through permission_classes,
    using self.permission_denied() so anonymous requests get a 401 and
    authenticated-but-unauthorized requests get a 403 -- the same
    401-vs-403 convention every other dashboard-only endpoint in this
    codebase follows.
    """

    @staticmethod
    def _aggregate_quantities(items: list[dict]) -> dict[tuple[str, int | None], int]:
        quantities_by_item: dict[tuple[str, int | None], int] = {}

        for item in items:
            code = item["public_code"].strip().upper()
            variant_id = item.get("variant_id")
            key = (code, variant_id)
            quantities_by_item[key] = quantities_by_item.get(key, 0) + item["quantity"]

        return quantities_by_item

    @staticmethod
    def _lock_products(
        quantities_by_item: dict[tuple[str, int | None], int], store: Store
    ) -> dict[str, Product]:
        codes = sorted({code for code, _variant_id in quantities_by_item})
        products = (
            Product.objects.select_for_update()
            .filter(public_code__in=codes, store=store)
            .order_by("id")
        )
        products_by_code = {product.public_code: product for product in products}
        missing_codes = [code for code in codes if code not in products_by_code]

        if missing_codes:
            raise serializers.ValidationError(
                {
                    "items": [
                        f'Código(s) não encontrado(s) nesta loja: {", ".join(missing_codes)}'
                    ]
                }
            )

        return products_by_code

    @staticmethod
    def _lock_active_variants(
        products_by_code: dict[str, Product],
    ) -> tuple[dict[int, ProductVariant], dict[int, list[ProductVariant]]]:
        variants = list(
            ProductVariant.objects.select_for_update()
            .filter(
                product_id__in=[product.id for product in products_by_code.values()],
                is_active=True,
            )
            .order_by("id")
        )
        variants_by_id = {variant.id: variant for variant in variants}
        variants_by_product_id: dict[int, list[ProductVariant]] = {}
        for variant in variants:
            variants_by_product_id.setdefault(variant.product_id, []).append(variant)

        return variants_by_id, variants_by_product_id

    def _reserve_stock(
        self, items: list[dict], store: Store
    ) -> tuple[list[dict], Decimal, dict[str, Product]]:
        quantities_by_item = self._aggregate_quantities(items)
        products_by_code = self._lock_products(quantities_by_item, store)
        variants_by_id, variants_by_product_id = self._lock_active_variants(
            products_by_code
        )

        normalized_items = []
        subtotal = Decimal("0.00")
        timestamp = timezone.now()

        for (code, variant_id), quantity in quantities_by_item.items():
            product = products_by_code[code]
            active_variants = variants_by_product_id.get(product.id, [])
            selected_variant = None

            if active_variants:
                if variant_id is None:
                    raise serializers.ValidationError(
                        {
                            "items": [
                                f'Produto "{product.name}" possui variantes. Informe a variante.'
                            ]
                        }
                    )

                selected_variant = variants_by_id.get(variant_id)
                if (
                    selected_variant is None
                    or selected_variant.product_id != product.id
                ):
                    raise serializers.ValidationError(
                        {"items": [f'Variante nao encontrada para "{product.name}".']}
                    )

                previous_stock = selected_variant.stock_quantity
                if previous_stock <= 0:
                    raise serializers.ValidationError(
                        {
                            "items": [
                                f'Variante "{selected_variant.name}" de "{product.name}" esta indisponivel.'
                            ]
                        }
                    )
            else:
                if variant_id is not None:
                    raise serializers.ValidationError(
                        {"items": [f'Variante nao encontrada para "{product.name}".']}
                    )
                previous_stock = product.stock_quantity

            if selected_variant is None and (
                not product.is_available or product.stock_quantity <= 0
            ):
                raise serializers.ValidationError(
                    {"items": [f'Produto "{product.name}" esta indisponivel.']}
                )

            if quantity > previous_stock:
                raise serializers.ValidationError(
                    {
                        "items": [
                            f'Quantidade solicitada para "{product.name}" excede o '
                            f"estoque disponivel ({previous_stock})."
                        ]
                    }
                )

            unit_price = Decimal(
                product.get_effective_price(selected_variant)
            ).quantize(Decimal("0.01"))
            line_total = (unit_price * quantity).quantize(Decimal("0.01"))
            subtotal += line_total
            new_stock = previous_stock - quantity

            variant_image_url = ""
            if selected_variant is not None and selected_variant.image:
                variant_image_url = selected_variant.image.url

            normalized_items.append(
                {
                    "product_id": product.id,
                    "variant_id": (
                        selected_variant.id if selected_variant is not None else None
                    ),
                    "product_name": product.name,
                    "variant_name": (
                        selected_variant.name if selected_variant is not None else ""
                    ),
                    "variant_color_hex": (
                        selected_variant.color_hex
                        if selected_variant is not None
                        else ""
                    ),
                    "variant_image_url": variant_image_url,
                    "public_code": product.public_code,
                    "sku": product.sku or "",
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "line_total": line_total,
                    "previous_stock": previous_stock,
                    "new_stock": new_stock,
                }
            )

            if selected_variant is not None:
                selected_variant.stock_quantity = new_stock
                selected_variant.updated_at = timestamp
                product.stock_quantity = sum(
                    variant.stock_quantity for variant in active_variants
                )
                product.is_available = product.stock_quantity > 0
                product.updated_at = timestamp
            else:
                product.stock_quantity = new_stock
                product.is_available = new_stock > 0
                product.updated_at = timestamp

        Product.objects.bulk_update(
            list(products_by_code.values()),
            ["stock_quantity", "is_available", "updated_at"],
        )
        if variants_by_id:
            ProductVariant.objects.bulk_update(
                list(variants_by_id.values()), ["stock_quantity", "updated_at"]
            )

        return normalized_items, subtotal, products_by_code

    def post(self, request, *args, **kwargs):
        started_at = time.monotonic()

        if not has_dashboard_write_access(request.user):
            self.permission_denied(
                request,
                message="Você não possui permissão para registrar vendas no PDV.",
            )

        store = resolve_request_store(request)
        serializer = PdvSaleRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        payment_method = validated["payment_method"]
        performed_by = request.user if request.user.is_authenticated else None
        performed_by_id = performed_by.id if performed_by is not None else None
        idempotency_key = validated.get("idempotency_key", "").strip()

        # Structured + sanitised: store, cart size, method and outcome only --
        # never a scanned code, customer name/phone/email, note or the raw
        # idempotency key. Enough to trace a duplicate or a slow finalize,
        # nothing a data-subject could be identified from.
        log_base = {
            "store_id": store.id,
            "item_count": len(validated["items"]),
            "payment_method": payment_method,
            "has_idempotency_key": bool(idempotency_key),
        }
        logger.info(
            "pdv.sale.finalize_started",
            extra={**log_base, "event": "pdv.sale.finalize_started"},
        )

        # A PDV sale does NOT read StoreCommerceSettings.accepts_pix/card/cash:
        # those flags are the *online storefront's* payment configuration
        # (their model docstring, the "Vendas online" tab, the go-live check
        # and the public projection all scope them to the vitrine). The
        # counter has always accepted pix/card/cash unconditionally and must
        # keep doing so -- a merchant disabling "cartao" for their online
        # checkout must not have their physical card machine refused. A
        # counter-specific payment config would be a separate product feature.

        idempotency_payload_hash = ""
        if idempotency_key:
            idempotency_payload_hash = build_pdv_idempotency_payload_hash(
                store=store,
                validated=validated,
                performed_by_id=performed_by_id,
            )
            existing = find_pdv_idempotent_order(
                store=store, idempotency_key=idempotency_key
            )
            if existing is not None:
                # The per-store unique constraint on `idempotency_key` is
                # shared with the online checkout (it is not channel-scoped),
                # so `existing` could be a virtual/WhatsApp order that happens
                # to hold this key. Either that, or a real payload mismatch,
                # is a genuine conflict -- never a safe PDV replay.
                is_pdv_replay = (
                    existing.channel == SaleOrder.CHANNEL_LOJA_FISICA
                    and existing.idempotency_payload_hash == idempotency_payload_hash
                )
                if not is_pdv_replay:
                    logger.warning(
                        "pdv.sale.idempotency_conflict",
                        extra={
                            **log_base,
                            "event": "pdv.sale.idempotency_conflict",
                            "order_reference": existing.order_reference,
                            "existing_channel": existing.channel,
                        },
                    )
                    return Response(
                        {
                            "code": "idempotency_key_conflict",
                            "detail": "Esta chave de venda ja foi usada com outro carrinho.",
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                logger.info(
                    "pdv.sale.finalize_replayed",
                    extra={
                        **log_base,
                        "event": "pdv.sale.finalize_replayed",
                        "order_reference": existing.order_reference,
                    },
                )
                return Response(
                    PdvSaleResponseSerializer(
                        serialize_persisted_pdv_sale(existing)
                    ).data,
                    status=status.HTTP_201_CREATED,
                )

        order_reference = build_sale_order_reference("PDV")
        customer_name = (
            validated.get("customer_name", "").strip() or DEFAULT_PDV_CUSTOMER_NAME
        )
        customer_phone = validated.get("customer_phone", "").strip()
        customer_email = validated.get("customer_email", "").strip()
        notes = validated.get("notes", "").strip()

        try:
            with transaction.atomic():
                normalized_items, subtotal, products_by_code = self._reserve_stock(
                    validated["items"], store
                )
                rounded_subtotal = subtotal.quantize(Decimal("0.01"))
                now = timezone.now()

                sale_order = SaleOrder.objects.create(
                    store=store,
                    order_reference=order_reference,
                    channel=SaleOrder.CHANNEL_LOJA_FISICA,
                    performed_by=performed_by,
                    idempotency_key=idempotency_key,
                    idempotency_payload_hash=idempotency_payload_hash,
                    customer_name=customer_name,
                    customer_phone=customer_phone,
                    customer_email=customer_email,
                    delivery_method="pickup",
                    payment_method=payment_method,
                    # A PDV sale is a completed in-person transaction: the
                    # money changed hands at the counter, so it starts
                    # already paid (online-sales foundation). The
                    # virtual/WhatsApp channel, by contrast, starts pending
                    # until an operator confirms.
                    payment_status=SaleOrder.PAYMENT_STATUS_PAID,
                    paid_at=now,
                    notes=notes,
                    subtotal=rounded_subtotal,
                    delivery_fee=Decimal("0.00"),
                    total=rounded_subtotal,
                )
                record_initial_payment_event(
                    sale_order,
                    source=PaymentStatusEvent.SOURCE_SYSTEM,
                    performed_by=performed_by,
                    note="Venda PDV concluida no balcao",
                )

                SaleOrderItem.objects.bulk_create(
                    [
                        SaleOrderItem(
                            order=sale_order,
                            product=products_by_code.get(item["public_code"]),
                            variant_id=item["variant_id"],
                            product_name=item["product_name"],
                            sku=item["sku"],
                            variant_name=item["variant_name"],
                            variant_color_hex=item["variant_color_hex"],
                            variant_image_url=item["variant_image_url"],
                            quantity=item["quantity"],
                            unit_price=item["unit_price"],
                            line_total=item["line_total"],
                        )
                        for item in normalized_items
                    ]
                )

                # Same reasoning as CheckoutWhatsAppView: the decrement
                # already happened above in _reserve_stock (one bulk_update,
                # inside the same lock) -- this just persists the audit trail
                # for it, built from data already in memory.
                StockMovement.objects.bulk_create(
                    [
                        StockMovement(
                            store=store,
                            product=products_by_code[item["public_code"]],
                            variant_id=item["variant_id"],
                            movement_type=StockMovement.TYPE_SAIDA,
                            quantity=item["quantity"],
                            previous_stock=item["previous_stock"],
                            new_stock=item["new_stock"],
                            reason=StockMovement.REASON_VENDA,
                            source=StockMovement.SOURCE_PDV,
                            sale_order=sale_order,
                            performed_by=performed_by,
                        )
                        for item in normalized_items
                    ]
                )

                response_serializer = PdvSaleResponseSerializer(
                    {
                        "order_reference": order_reference,
                        "items": normalized_items,
                        "subtotal": rounded_subtotal,
                        "total": rounded_subtotal,
                        "payment_method": payment_method,
                        "created_at": sale_order.created_at,
                        "customer_email": customer_email,
                    }
                )
        except IntegrityError:
            # Something tripped a DB constraint after the pre-flight check.
            # The transaction above rolled back in full (no stock decrement,
            # no order, no payment event).
            existing = find_pdv_idempotent_order(
                store=store, idempotency_key=idempotency_key
            )
            if existing is not None and existing.channel == SaleOrder.CHANNEL_LOJA_FISICA:
                # A concurrent PDV request holding the same key won the race.
                logger.info(
                    "pdv.sale.finalize_deduplicated",
                    extra={
                        **log_base,
                        "event": "pdv.sale.finalize_deduplicated",
                        "order_reference": existing.order_reference,
                    },
                )
                return Response(
                    PdvSaleResponseSerializer(
                        serialize_persisted_pdv_sale(existing)
                    ).data,
                    status=status.HTTP_201_CREATED,
                )
            if existing is not None:
                # The (store, key) unique constraint fired because another
                # channel already holds this key. A clean 409 beats a 500.
                logger.warning(
                    "pdv.sale.idempotency_conflict",
                    extra={
                        **log_base,
                        "event": "pdv.sale.idempotency_conflict",
                        "order_reference": existing.order_reference,
                        "existing_channel": existing.channel,
                    },
                )
                return Response(
                    {
                        "code": "idempotency_key_conflict",
                        "detail": "Esta chave de venda ja foi usada com outro carrinho.",
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            raise
        except serializers.ValidationError:
            logger.warning(
                "pdv.sale.finalize_failed",
                extra={**log_base, "event": "pdv.sale.finalize_failed"},
            )
            raise

        logger.info(
            "pdv.sale.finalize_succeeded",
            extra={
                **log_base,
                "event": "pdv.sale.finalize_succeeded",
                "order_reference": order_reference,
                "duration_ms": round((time.monotonic() - started_at) * 1000, 1),
            },
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class PdvReceiptEmailSerializer(serializers.Serializer):
    """Validates a request to email an already-built PDV receipt PDF."""

    email = serializers.EmailField()
    pdf_base64 = serializers.CharField()

    def validate_pdf_base64(self, value: str) -> bytes:
        try:
            pdf_bytes = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise serializers.ValidationError(
                "Não foi possível decodificar o PDF enviado."
            ) from exc

        if not pdf_bytes:
            raise serializers.ValidationError("O PDF enviado está vazio.")

        if len(pdf_bytes) > MAX_RECEIPT_PDF_BYTES:
            raise serializers.ValidationError(
                "O PDF enviado excede o tamanho máximo permitido (5MB)."
            )

        if not pdf_bytes.startswith(PDF_MAGIC_NUMBER):
            raise serializers.ValidationError(
                "O arquivo enviado não parece ser um PDF válido."
            )

        return pdf_bytes


class PdvReceiptEmailView(APIView):
    """POST /v1/pdv/sales/<order_reference>/receipt-email/ -- email a
    client-built receipt PDF (see utils/receiptPdf.ts) to a customer.

    Scoped to a real SaleOrder belonging to the requester's store -- not a
    generic "email this file to that address" relay -- so this can't be
    repurposed to send arbitrary mail using the dashboard's own SMTP
    reputation. There is no async task queue in this project (see
    PasswordResetRequestView, the only other email sender, which is also
    synchronous), so this send blocks the request like that one does.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [PdvReceiptEmailThrottle]

    def post(self, request, *args, **kwargs):
        if not has_dashboard_write_access(request.user):
            self.permission_denied(
                request, message="Você não possui permissão para enviar recibos do PDV."
            )

        store = resolve_request_store(request)
        sale_order = SaleOrder.objects.filter(
            order_reference=kwargs["order_reference"], store=store
        ).first()
        if sale_order is None:
            return not_found_error("Venda não encontrada nesta loja.")

        serializer = PdvReceiptEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        pdf_bytes = serializer.validated_data["pdf_base64"]

        message = EmailMessage(
            subject=f"Recibo da compra {sale_order.order_reference}",
            body=(
                f"Olá! Segue em anexo o recibo da sua compra "
                f"{sale_order.order_reference}."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[email],
        )
        message.attach(
            f"{sale_order.order_reference}.pdf", pdf_bytes, "application/pdf"
        )
        message.send(fail_silently=False)

        return Response({"sent": True}, status=status.HTTP_200_OK)
