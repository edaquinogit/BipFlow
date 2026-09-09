"""Online-sales foundation -- Fase C: payment lifecycle.

Covers the payments.py state machine, the PDV/cancellation automatic
transitions, the append-only PaymentStatusEvent audit, the operator payment
action endpoint (RBAC + tenant isolation), and the paid-vs-created split in
the dashboard summary metrics.
"""
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from bipdelivery.api.models import (
    PaymentStatusEvent,
    SaleOrder,
    SaleOrderItem,
    StockMovement,
    StoreMembership,
)
from bipdelivery.api.payments import (
    PaymentTransitionError,
    available_manual_targets,
    settle_payment_for_cancelled_order,
    transition_payment,
)
from bipdelivery.tests.test_store_active_isolation import TwoStoreFixtureMixin


def make_order(store, **overrides) -> SaleOrder:
    fields = {
        "store": store,
        "order_reference": f"BPF-{uuid4().hex[:10].upper()}",
        "customer_name": "Cliente Teste",
        "customer_phone": "71999990000",
        "delivery_method": "pickup",
        "payment_method": "pix",
        "subtotal": Decimal("30.00"),
        "delivery_fee": Decimal("0.00"),
        "total": Decimal("30.00"),
    }
    fields.update(overrides)
    return SaleOrder.objects.create(**fields)


class PaymentStateMachineTest(TestCase):
    def setUp(self) -> None:
        from bipdelivery.api.models import Store

        self.store = Store.get_default()

    def _order(self, payment_status: str = SaleOrder.PAYMENT_STATUS_PENDING) -> SaleOrder:
        return make_order(self.store, payment_status=payment_status)

    def test_pending_to_paid_records_paid_at_and_event(self) -> None:
        order = self._order()
        event = transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_PAID,
            source=PaymentStatusEvent.SOURCE_MANUAL,
        )
        order.refresh_from_db()

        self.assertEqual(order.payment_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertIsNotNone(order.paid_at)
        self.assertEqual(event.previous_status, SaleOrder.PAYMENT_STATUS_PENDING)
        self.assertEqual(event.new_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertEqual(event.store_id, order.store_id)

    def test_all_defined_transitions_are_allowed(self) -> None:
        cases = [
            (SaleOrder.PAYMENT_STATUS_PENDING, SaleOrder.PAYMENT_STATUS_PAID),
            (SaleOrder.PAYMENT_STATUS_PENDING, SaleOrder.PAYMENT_STATUS_FAILED),
            (SaleOrder.PAYMENT_STATUS_PENDING, SaleOrder.PAYMENT_STATUS_CANCELLED),
            (SaleOrder.PAYMENT_STATUS_FAILED, SaleOrder.PAYMENT_STATUS_PENDING),
            (SaleOrder.PAYMENT_STATUS_FAILED, SaleOrder.PAYMENT_STATUS_CANCELLED),
            (SaleOrder.PAYMENT_STATUS_PAID, SaleOrder.PAYMENT_STATUS_REFUND_PENDING),
            (
                SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
                SaleOrder.PAYMENT_STATUS_REFUNDED,
            ),
        ]
        for source_status, target in cases:
            with self.subTest(transition=f"{source_status}->{target}"):
                order = self._order(source_status)
                event = transition_payment(
                    order, to_status=target, source=PaymentStatusEvent.SOURCE_SYSTEM
                )
                order.refresh_from_db()
                self.assertEqual(order.payment_status, target)
                self.assertIsNotNone(event)

    def test_forbidden_transitions_raise_and_do_not_touch_the_db(self) -> None:
        forbidden = [
            (SaleOrder.PAYMENT_STATUS_PAID, SaleOrder.PAYMENT_STATUS_PENDING),
            (SaleOrder.PAYMENT_STATUS_PAID, SaleOrder.PAYMENT_STATUS_REFUNDED),
            (SaleOrder.PAYMENT_STATUS_REFUNDED, SaleOrder.PAYMENT_STATUS_PENDING),
            (SaleOrder.PAYMENT_STATUS_CANCELLED, SaleOrder.PAYMENT_STATUS_PAID),
            (
                SaleOrder.PAYMENT_STATUS_PENDING,
                SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
            ),
        ]
        for source_status, target in forbidden:
            with self.subTest(transition=f"{source_status}->{target}"):
                order = self._order(source_status)
                with self.assertRaises(PaymentTransitionError):
                    transition_payment(
                        order,
                        to_status=target,
                        source=PaymentStatusEvent.SOURCE_MANUAL,
                    )
                order.refresh_from_db()
                self.assertEqual(order.payment_status, source_status)
                self.assertFalse(
                    PaymentStatusEvent.objects.filter(order=order).exists()
                )

    def test_same_status_repeat_is_an_idempotent_noop(self) -> None:
        order = self._order(SaleOrder.PAYMENT_STATUS_PAID)
        result = transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_PAID,
            source=PaymentStatusEvent.SOURCE_MANUAL,
        )
        self.assertIsNone(result)
        self.assertEqual(PaymentStatusEvent.objects.filter(order=order).count(), 0)

    def test_refunded_records_refunded_at(self) -> None:
        order = self._order(SaleOrder.PAYMENT_STATUS_REFUND_PENDING)
        transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_REFUNDED,
            source=PaymentStatusEvent.SOURCE_MANUAL,
        )
        order.refresh_from_db()
        self.assertIsNotNone(order.refunded_at)

    def test_available_manual_targets(self) -> None:
        self.assertEqual(
            available_manual_targets(self._order(SaleOrder.PAYMENT_STATUS_PENDING)),
            [SaleOrder.PAYMENT_STATUS_PAID, SaleOrder.PAYMENT_STATUS_FAILED],
        )
        self.assertEqual(
            available_manual_targets(self._order(SaleOrder.PAYMENT_STATUS_FAILED)),
            [SaleOrder.PAYMENT_STATUS_PENDING],
        )
        self.assertEqual(
            available_manual_targets(
                self._order(SaleOrder.PAYMENT_STATUS_REFUND_PENDING)
            ),
            [SaleOrder.PAYMENT_STATUS_REFUNDED],
        )
        # A paid order offers no manual button -- refund only via cancellation.
        self.assertEqual(
            available_manual_targets(self._order(SaleOrder.PAYMENT_STATUS_PAID)),
            [],
        )

    def test_settle_paid_order_never_auto_refunds(self) -> None:
        order = self._order(SaleOrder.PAYMENT_STATUS_PAID)
        settle_payment_for_cancelled_order(order)
        order.refresh_from_db()
        self.assertEqual(
            order.payment_status, SaleOrder.PAYMENT_STATUS_REFUND_PENDING
        )
        self.assertIsNone(order.refunded_at)


class PaymentLifecycleChannelDefaultsTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.store_b.whatsapp_phone = "5571988887777"
        self.store_b.save(update_fields=["whatsapp_phone"])
        self.product_b.stock_quantity = 20
        self.product_b.public_code = "PCODE0001"
        self.product_b.is_available = True
        self.product_b.save(
            update_fields=["stock_quantity", "public_code", "is_available"]
        )

    def test_virtual_whatsapp_order_starts_pending(self) -> None:
        response = APIClient().post(
            "/api/v1/checkout/whatsapp/",
            {
                "items": [{"product_id": self.product_b.id, "quantity": 1}],
                "customer": {
                    "delivery_method": "pickup",
                    "payment_method": "pix",
                    "full_name": "Cliente Vitrine",
                    "phone": "71999998888",
                },
            },
            format="json",
            HTTP_X_STORE_SLUG=self.store_b.slug,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        order = SaleOrder.objects.get(
            order_reference=response.data["order_reference"]
        )
        self.assertEqual(order.payment_status, SaleOrder.PAYMENT_STATUS_PENDING)
        self.assertIsNone(order.paid_at)
        # A plain pending birth needs no ledger row.
        self.assertFalse(
            PaymentStatusEvent.objects.filter(order=order).exists()
        )

    def test_new_pdv_sale_starts_paid_with_an_event(self) -> None:
        client = APIClient()
        client.force_authenticate(
            user=self.user_b, token={"store_id": self.store_b.id}
        )
        response = client.post(
            "/api/v1/pdv/sales/",
            {
                "items": [{"public_code": "PCODE0001", "quantity": 2}],
                "payment_method": "cash",
            },
            format="json",
        )
        self.assertEqual(
            response.status_code, status.HTTP_201_CREATED, msg=response.data
        )
        order = SaleOrder.objects.get(
            order_reference=response.data["order_reference"]
        )
        self.assertEqual(order.payment_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertIsNotNone(order.paid_at)
        event = PaymentStatusEvent.objects.get(order=order)
        self.assertEqual(event.new_status, SaleOrder.PAYMENT_STATUS_PAID)
        self.assertEqual(event.source, PaymentStatusEvent.SOURCE_SYSTEM)
        self.assertEqual(event.store_id, self.store_b.id)


class PaymentCancellationIntegrationTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.product_b.stock_quantity = 10
        self.product_b.is_available = True
        self.product_b.save(update_fields=["stock_quantity", "is_available"])

    def _order_with_item(self, *, payment_status: str, qty: int = 3) -> SaleOrder:
        order = make_order(
            self.store_b,
            channel=SaleOrder.CHANNEL_VIRTUAL,
            payment_status=payment_status,
        )
        SaleOrderItem.objects.create(
            order=order,
            product=self.product_b,
            product_name=self.product_b.name,
            quantity=qty,
            unit_price=self.product_b.price,
            line_total=self.product_b.price * qty,
        )
        self.product_b.stock_quantity -= qty
        self.product_b.save(update_fields=["stock_quantity"])
        return order

    def _cancel(self, order: SaleOrder):
        return self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",
            {"status": "cancelled"},
            format="json",
        )

    def test_cancelling_a_pending_order_settles_payment_as_cancelled(self) -> None:
        order = self._order_with_item(
            payment_status=SaleOrder.PAYMENT_STATUS_PENDING
        )
        response = self._cancel(order)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, SaleOrder.STATUS_CANCELLED)
        self.assertEqual(
            order.payment_status, SaleOrder.PAYMENT_STATUS_CANCELLED
        )
        event = PaymentStatusEvent.objects.get(order=order)
        self.assertEqual(event.new_status, SaleOrder.PAYMENT_STATUS_CANCELLED)
        self.assertEqual(event.source, PaymentStatusEvent.SOURCE_SYSTEM)

    def test_cancelling_a_paid_order_opens_refund_pending(self) -> None:
        order = self._order_with_item(payment_status=SaleOrder.PAYMENT_STATUS_PAID)
        response = self._cancel(order)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(
            order.payment_status, SaleOrder.PAYMENT_STATUS_REFUND_PENDING
        )
        self.assertIsNone(order.refunded_at)

    def test_cancelling_a_paid_order_restocks_exactly_once(self) -> None:
        order = self._order_with_item(
            payment_status=SaleOrder.PAYMENT_STATUS_PAID, qty=3
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 7)

        self._cancel(order)
        self._cancel(order)  # idempotent

        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)
        self.assertEqual(
            StockMovement.objects.filter(
                sale_order=order, reason=StockMovement.REASON_VENDA_CANCELADA
            ).count(),
            1,
        )
        # payment_status_events: exactly one transition recorded.
        self.assertEqual(
            PaymentStatusEvent.objects.filter(order=order).count(), 1
        )

    def test_second_cancel_with_a_stale_instance_still_restocks_only_once(
        self,
    ) -> None:
        """The in-transaction ``select_for_update`` re-check catches a racing
        cancel whose in-memory ``order.status`` is stale (as a concurrent
        request's would be), so neither stock nor payment moves twice.
        """
        from bipdelivery.api.stock import apply_order_cancellation

        order = self._order_with_item(
            payment_status=SaleOrder.PAYMENT_STATUS_PAID, qty=3
        )

        # First cancel: real one, through the endpoint.
        self.assertEqual(self._cancel(order).status_code, status.HTTP_200_OK)
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)

        # Second cancel: a fresh instance whose `status` is forced back to a
        # non-cancelled value -- exactly the view of the world a concurrent
        # request that read the row before the first commit would hold. The
        # pre-transaction guard is bypassed; only the locked re-check saves us.
        stale = SaleOrder.objects.get(pk=order.pk)
        stale.status = SaleOrder.STATUS_PREPARED
        movements = apply_order_cancellation(
            order=stale, store=self.store_b, performed_by=self.user_b
        )

        self.assertEqual(movements, [])
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)  # not 13
        self.assertEqual(
            StockMovement.objects.filter(
                sale_order=order, reason=StockMovement.REASON_VENDA_CANCELADA
            ).count(),
            1,
        )
        self.assertEqual(
            PaymentStatusEvent.objects.filter(order=order).count(), 1
        )

    def test_cancel_with_stale_pending_instance_after_concurrent_payment_confirm(
        self,
    ) -> None:
        """A cancel whose in-memory ``order.payment_status`` is a stale
        ``pending`` -- while the row was really moved to ``paid`` by a
        concurrent payment confirmation between the caller's read and the
        cancel -- must settle as ``refund_pending`` off the locked row, never
        crash on an invalid ``paid -> cancelled`` transition, and restock
        exactly once.
        """
        from bipdelivery.api.stock import apply_order_cancellation

        order = self._order_with_item(
            payment_status=SaleOrder.PAYMENT_STATUS_PENDING, qty=3
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 7)

        # The instance the cancel path will receive: read now, while payment
        # is still `pending`, and deliberately never refreshed afterwards.
        stale = SaleOrder.objects.get(pk=order.pk)
        self.assertEqual(stale.payment_status, SaleOrder.PAYMENT_STATUS_PENDING)

        # A concurrent request confirms the payment through the official flow.
        transition_payment(
            order,
            to_status=SaleOrder.PAYMENT_STATUS_PAID,
            source=PaymentStatusEvent.SOURCE_MANUAL,
            performed_by=self.user_b,
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, SaleOrder.PAYMENT_STATUS_PAID)

        # Cancel with the stale instance (still `pending` in memory).
        movements = apply_order_cancellation(
            order=stale, store=self.store_b, performed_by=self.user_b
        )
        self.assertEqual(len(movements), 1)

        order.refresh_from_db()
        self.assertEqual(order.status, SaleOrder.STATUS_CANCELLED)
        self.assertEqual(
            order.payment_status, SaleOrder.PAYMENT_STATUS_REFUND_PENDING
        )
        self.assertIsNone(order.refunded_at)
        # The stale instance handed in comes back refreshed to committed state.
        self.assertEqual(stale.status, SaleOrder.STATUS_CANCELLED)
        self.assertEqual(
            stale.payment_status, SaleOrder.PAYMENT_STATUS_REFUND_PENDING
        )

        # Stock restored exactly once.
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)
        self.assertEqual(
            StockMovement.objects.filter(
                sale_order=order, reason=StockMovement.REASON_VENDA_CANCELADA
            ).count(),
            1,
        )

        # Payment ledger: pending->paid (confirm) then paid->refund_pending
        # (settlement); never a `cancelled` or `refunded` row.
        events = list(
            PaymentStatusEvent.objects.filter(order=order).order_by("id")
        )
        self.assertEqual(
            [event.new_status for event in events],
            [
                SaleOrder.PAYMENT_STATUS_PAID,
                SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
            ],
        )
        self.assertEqual(events[-1].source, PaymentStatusEvent.SOURCE_SYSTEM)
        self.assertEqual(
            events[-1].previous_status, SaleOrder.PAYMENT_STATUS_PAID
        )

        # Cancelling again, also with a stale non-cancelled instance, is inert.
        stale_again = SaleOrder.objects.get(pk=order.pk)
        stale_again.status = SaleOrder.STATUS_PREPARED
        self.assertEqual(
            apply_order_cancellation(
                order=stale_again, store=self.store_b, performed_by=self.user_b
            ),
            [],
        )
        self.product_b.refresh_from_db()
        self.assertEqual(self.product_b.stock_quantity, 10)
        self.assertEqual(
            StockMovement.objects.filter(
                sale_order=order, reason=StockMovement.REASON_VENDA_CANCELADA
            ).count(),
            1,
        )
        self.assertEqual(
            PaymentStatusEvent.objects.filter(order=order).count(), 2
        )


class PaymentActionEndpointTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.order = make_order(
            self.store_b, payment_status=SaleOrder.PAYMENT_STATUS_PENDING
        )

    def _url(self, order: SaleOrder) -> str:
        return f"/api/v1/sales-orders/{order.id}/payment/"

    def test_confirm_payment(self) -> None:
        response = self.client.patch(
            self._url(self.order),
            {"payment_status": "paid", "reference": "TED 4432"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.data)
        self.assertEqual(response.data["payment_status"], "paid")
        self.assertEqual(response.data["payment_reference"], "TED 4432")
        self.order.refresh_from_db()
        self.assertIsNotNone(self.order.paid_at)
        event = PaymentStatusEvent.objects.get(order=self.order)
        self.assertEqual(event.source, PaymentStatusEvent.SOURCE_MANUAL)
        self.assertEqual(event.performed_by, self.user_b)

    def test_register_failure_then_retry(self) -> None:
        self.client.patch(
            self._url(self.order), {"payment_status": "failed"}, format="json"
        )
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, "failed")

        response = self.client.patch(
            self._url(self.order), {"payment_status": "pending"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["payment_status"], "pending")

    def test_cannot_confirm_refund_before_refund_pending(self) -> None:
        response = self.client.patch(
            self._url(self.order), {"payment_status": "refunded"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.order.refresh_from_db()
        self.assertEqual(self.order.payment_status, "pending")

    def test_confirm_refund_after_refund_pending(self) -> None:
        order = make_order(
            self.store_b, payment_status=SaleOrder.PAYMENT_STATUS_REFUND_PENDING
        )
        response = self.client.patch(
            self._url(order), {"payment_status": "refunded"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, "refunded")
        self.assertIsNotNone(order.refunded_at)

    def test_operator_cannot_directly_cancel_or_open_refund(self) -> None:
        for target in ("cancelled", "refund_pending"):
            with self.subTest(target=target):
                response = self.client.patch(
                    self._url(self.order),
                    {"payment_status": target},
                    format="json",
                )
                self.assertEqual(
                    response.status_code, status.HTTP_400_BAD_REQUEST
                )

    def test_viewer_cannot_change_payment(self) -> None:
        viewer = User.objects.create_user(
            username="pay_viewer", password="testpass123"
        )
        StoreMembership.objects.create(
            store=self.store_b, user=viewer, role=StoreMembership.ROLE_VIEWER
        )
        client = APIClient()
        client.force_authenticate(user=viewer, token={"store_id": self.store_b.id})
        response = client.patch(
            self._url(self.order), {"payment_status": "paid"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_cannot_change_payment(self) -> None:
        response = APIClient().patch(
            self._url(self.order), {"payment_status": "paid"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cross_store_order_payment_is_not_found(self) -> None:
        foreign = make_order(
            self.store_a, payment_status=SaleOrder.PAYMENT_STATUS_PENDING
        )
        response = self.client.patch(
            self._url(foreign), {"payment_status": "paid"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_idempotent_repeat_confirm(self) -> None:
        first = self.client.patch(
            self._url(self.order), {"payment_status": "paid"}, format="json"
        )
        second = self.client.patch(
            self._url(self.order), {"payment_status": "paid"}, format="json"
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(
            PaymentStatusEvent.objects.filter(order=self.order).count(), 1
        )

    def test_detail_exposes_history_and_available_actions(self) -> None:
        self.client.patch(
            self._url(self.order), {"payment_status": "paid"}, format="json"
        )
        response = self.client.get(f"/api/v1/sales-orders/{self.order.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["payment_status"], "paid")
        self.assertEqual(len(response.data["payment_status_events"]), 1)
        self.assertEqual(response.data["available_payment_actions"], [])


class PaymentMetricsTest(TwoStoreFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        # Start from a clean slate: the fixture seeds one order per store.
        SaleOrder.objects.all().delete()
        # Two live non-cancelled orders: one paid (R$ 100), one pending (R$ 40).
        make_order(
            self.store_b,
            payment_status=SaleOrder.PAYMENT_STATUS_PAID,
            total=Decimal("100.00"),
        )
        make_order(
            self.store_b,
            payment_status=SaleOrder.PAYMENT_STATUS_PENDING,
            total=Decimal("40.00"),
        )
        # A realistic refund_pending: a paid order that was then cancelled
        # (status=cancelled, payment_status=refund_pending -- the only way
        # this state is reachable in production).
        self.refunded_order = make_order(
            self.store_b,
            status=SaleOrder.STATUS_CANCELLED,
            payment_status=SaleOrder.PAYMENT_STATUS_REFUND_PENDING,
            total=Decimal("25.00"),
        )

    def test_summary_separates_confirmed_revenue_from_order_volume(self) -> None:
        response = self.client.get("/api/v1/sales-orders/summary/?period=30d")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data

        # Order volume: only the two non-cancelled orders (the cancelled
        # refund_pending one drops out here, same as before this cycle).
        self.assertEqual(data["orders_count"], 2)
        self.assertEqual(Decimal(data["revenue_total"]), Decimal("140.00"))

        # Confirmed money: only the paid order.
        self.assertEqual(Decimal(data["paid_revenue_total"]), Decimal("100.00"))
        self.assertEqual(data["paid_orders_count"], 1)
        self.assertEqual(Decimal(data["pending_payment_total"]), Decimal("40.00"))
        self.assertEqual(data["pending_payment_count"], 1)

        # Refund pending is measured over a cancelled-inclusive base, so it
        # surfaces even though the order is operationally cancelled.
        self.assertEqual(
            Decimal(data["refund_pending_total"]), Decimal("25.00")
        )
        self.assertEqual(data["refund_pending_count"], 1)

    def test_refund_pending_from_a_real_cancellation_flow_is_reported(self) -> None:
        """End to end: pay -> cancel -> the refund_pending amount shows in
        summary while confirmed revenue and volume stay clean.
        """
        SaleOrder.objects.all().delete()
        cache.clear()
        order = make_order(
            self.store_b, payment_status=SaleOrder.PAYMENT_STATUS_PAID, total=Decimal("80.00")
        )
        self.client.patch(
            f"/api/v1/sales-orders/{order.id}/status/",
            {"status": "cancelled"},
            format="json",
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, SaleOrder.PAYMENT_STATUS_REFUND_PENDING)

        data = self.client.get("/api/v1/sales-orders/summary/?period=30d").data
        self.assertEqual(data["orders_count"], 0)
        self.assertEqual(Decimal(data["revenue_total"]), Decimal("0.00"))
        self.assertEqual(Decimal(data["paid_revenue_total"]), Decimal("0.00"))
        self.assertEqual(Decimal(data["refund_pending_total"]), Decimal("80.00"))
        self.assertEqual(data["refund_pending_count"], 1)

    def test_breakdown_by_payment_method_carries_paid_slice(self) -> None:
        response = self.client.get("/api/v1/sales-orders/breakdown/?period=30d")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pix_row = next(
            row
            for row in response.data["by_payment_method"]
            if row["payment_method"] == "pix"
        )
        # by_payment_method excludes cancelled, so only the two live orders.
        self.assertEqual(Decimal(pix_row["revenue_total"]), Decimal("140.00"))
        self.assertEqual(Decimal(pix_row["paid_revenue_total"]), Decimal("100.00"))
