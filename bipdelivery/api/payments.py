"""Payment lifecycle state machine for SaleOrder (online-sales foundation,
see docs/architecture/online-sales-foundation.md).

Single source of truth for *how* `SaleOrder.payment_status` may move. Views,
serializers and the PDV/cancellation paths call in here; none of them encode
a transition rule of their own.

Bip Flow does not process money. Every transition is either an operator
recording what happened outside the system, or one of the two automatic
transitions:
  * a completed PDV sale is created already `paid`;
  * cancelling an order settles a pending/failed payment as `cancelled`, or
    opens a `refund_pending` on a paid one (never an automatic `refunded` --
    no real refund is executed here).

Each successful transition writes exactly one append-only PaymentStatusEvent
inside the same transaction as the status change.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import PaymentStatusEvent, SaleOrder

# Directed graph of allowed payment-status transitions. A key missing from a
# value set means that move is rejected; `refunded` and `cancelled` are
# terminal (no outgoing edges).
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    SaleOrder.PAYMENT_STATUS_PENDING: {
        SaleOrder.PAYMENT_STATUS_PAID,
        SaleOrder.PAYMENT_STATUS_FAILED,
        SaleOrder.PAYMENT_STATUS_CANCELLED,
    },
    SaleOrder.PAYMENT_STATUS_FAILED: {
        SaleOrder.PAYMENT_STATUS_PENDING,
        SaleOrder.PAYMENT_STATUS_CANCELLED,
    },
    SaleOrder.PAYMENT_STATUS_PAID: {
        SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
    },
    SaleOrder.PAYMENT_STATUS_REFUND_PENDING: {
        SaleOrder.PAYMENT_STATUS_REFUNDED,
    },
    SaleOrder.PAYMENT_STATUS_REFUNDED: set(),
    SaleOrder.PAYMENT_STATUS_CANCELLED: set(),
}

# Transitions an authorised operator may trigger by hand through the order's
# payment action (see SaleOrderViewSet.update_payment). `cancelled` and
# `refund_pending` are deliberately absent -- those only ever come from
# order cancellation, never a manual button.
MANUAL_OPERATOR_TARGETS: dict[str, list[str]] = {
    SaleOrder.PAYMENT_STATUS_PENDING: [
        SaleOrder.PAYMENT_STATUS_PAID,
        SaleOrder.PAYMENT_STATUS_FAILED,
    ],
    SaleOrder.PAYMENT_STATUS_FAILED: [
        SaleOrder.PAYMENT_STATUS_PENDING,
    ],
    SaleOrder.PAYMENT_STATUS_REFUND_PENDING: [
        SaleOrder.PAYMENT_STATUS_REFUNDED,
    ],
}

# UI labels (pt-BR) for each internal code. Kept here so the API and any
# server-rendered surface share one map; the frontend mirrors it.
PAYMENT_STATUS_LABELS: dict[str, str] = {
    SaleOrder.PAYMENT_STATUS_PENDING: "Pagamento pendente",
    SaleOrder.PAYMENT_STATUS_PAID: "Pago",
    SaleOrder.PAYMENT_STATUS_FAILED: "Pagamento falhou",
    SaleOrder.PAYMENT_STATUS_REFUND_PENDING: "Reembolso pendente",
    SaleOrder.PAYMENT_STATUS_REFUNDED: "Reembolsado",
    SaleOrder.PAYMENT_STATUS_CANCELLED: "Pagamento cancelado",
}


class PaymentTransitionError(Exception):
    """Raised when a requested payment-status transition is not allowed.

    Carries stable machine-readable data so callers can map it to a clean
    API error without re-deriving the reason.
    """

    def __init__(self, message: str, *, code: str, current: str, requested: str):
        super().__init__(message)
        self.message = message
        self.code = code
        self.current = current
        self.requested = requested


def can_transition(current: str, requested: str) -> bool:
    """Whether `current -> requested` is a defined edge in the state machine."""
    return requested in ALLOWED_TRANSITIONS.get(current, set())


def available_manual_targets(order: SaleOrder) -> list[str]:
    """Payment statuses an operator may move `order` to by hand, right now."""
    return list(MANUAL_OPERATOR_TARGETS.get(order.payment_status, []))


@transaction.atomic
def transition_payment(
    order: SaleOrder,
    *,
    to_status: str,
    source: str,
    performed_by=None,
    reference: str = "",
    note: str = "",
    now=None,
) -> PaymentStatusEvent | None:
    """Move `order`'s payment status to `to_status`, atomically and audited.

    * Re-locks the order row (`select_for_update`) so concurrent callers
      serialise on it.
    * Idempotent: if the order is already at `to_status`, nothing changes and
      ``None`` is returned (no event, no error).
    * An undefined transition raises ``PaymentTransitionError`` and leaves the
      database untouched.
    * On success: updates ``payment_status`` (+ ``paid_at`` / ``refunded_at``
      / ``payment_reference`` as applicable), writes one PaymentStatusEvent in
      this same transaction, refreshes the passed instance, and returns the
      event.
    """
    locked = SaleOrder.objects.select_for_update().get(pk=order.pk)
    current = locked.payment_status
    timestamp = now or timezone.now()
    trimmed_reference = (reference or "").strip()[:64]

    if current == to_status:
        # Same-status repeat: treat as a completed no-op so a double-submit or
        # a retried request never double-writes an event.
        _sync_instance(order, locked)
        return None

    if not can_transition(current, to_status):
        raise PaymentTransitionError(
            (
                "Transicao de pagamento invalida: "
                f'"{PAYMENT_STATUS_LABELS.get(current, current)}" -> '
                f'"{PAYMENT_STATUS_LABELS.get(to_status, to_status)}".'
            ),
            code="invalid_payment_transition",
            current=current,
            requested=to_status,
        )

    update_fields = ["payment_status", "updated_at"]
    locked.payment_status = to_status

    if to_status == SaleOrder.PAYMENT_STATUS_PAID and locked.paid_at is None:
        locked.paid_at = timestamp
        update_fields.append("paid_at")
    if to_status == SaleOrder.PAYMENT_STATUS_REFUNDED and locked.refunded_at is None:
        locked.refunded_at = timestamp
        update_fields.append("refunded_at")
    if trimmed_reference:
        locked.payment_reference = trimmed_reference
        update_fields.append("payment_reference")

    locked.save(update_fields=update_fields)

    event = PaymentStatusEvent.objects.create(
        store_id=locked.store_id,
        order=locked,
        previous_status=current,
        new_status=to_status,
        source=source,
        performed_by=performed_by,
        reference=trimmed_reference,
        note=(note or "").strip()[:200],
    )

    _sync_instance(order, locked)
    return event


def settle_payment_for_cancelled_order(
    order: SaleOrder, *, performed_by=None, now=None
) -> PaymentStatusEvent | None:
    """Move the payment side of a just-cancelled order to its resting state.

    pending/failed -> cancelled; paid -> refund_pending (operator confirms the
    real refund later). Anything already terminal (refund_pending, refunded,
    cancelled) is left untouched. Called from apply_order_cancellation inside
    its transaction.
    """
    if order.payment_status in (
        SaleOrder.PAYMENT_STATUS_PENDING,
        SaleOrder.PAYMENT_STATUS_FAILED,
    ):
        return transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_CANCELLED,
            source=PaymentStatusEvent.SOURCE_SYSTEM,
            performed_by=performed_by,
            note="Pedido cancelado",
            now=now,
        )

    if order.payment_status == SaleOrder.PAYMENT_STATUS_PAID:
        return transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
            source=PaymentStatusEvent.SOURCE_SYSTEM,
            performed_by=performed_by,
            note="Pedido pago cancelado -- reembolso a confirmar",
            now=now,
        )

    return None


def record_initial_payment_event(
    order: SaleOrder, *, source: str, performed_by=None, note: str = ""
) -> PaymentStatusEvent:
    """Log the creation of an order that starts in a non-pending payment state.

    Used by the PDV, whose sales are created already `paid`: there is no
    transition to audit, but the ledger should still show how the order
    reached `paid`. `previous_status` is recorded as `pending` (the notional
    starting point) so the row reads as a normal pending -> paid step.
    """
    return PaymentStatusEvent.objects.create(
        store_id=order.store_id,
        order=order,
        previous_status=SaleOrder.PAYMENT_STATUS_PENDING,
        new_status=order.payment_status,
        source=source,
        performed_by=performed_by,
        note=(note or "").strip()[:200],
    )


def _sync_instance(target: SaleOrder, source: SaleOrder) -> None:
    """Copy the payment fields from the locked row back onto the caller's instance."""
    for field in ("payment_status", "paid_at", "refunded_at", "payment_reference"):
        setattr(target, field, getattr(source, field))
