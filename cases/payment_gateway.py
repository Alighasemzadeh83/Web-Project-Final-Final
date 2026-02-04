from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from django.conf import settings
import stripe


class PaymentGatewayError(Exception):
    def __init__(self, message: str, *, code: int | None = None, payload: Any | None = None):
        super().__init__(message)
        self.code = code
        self.payload = payload


@dataclass
class PaymentRequestResult:
    authority: str
    payment_url: str
    raw: dict[str, Any]
    mock: bool = False


@dataclass
class PaymentVerifyResult:
    ok: bool
    ref_id: str
    raw: dict[str, Any]
    code: int | None = None
    mock: bool = False


def _idpay_headers() -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": settings.IDPAY_API_KEY or settings.PAYMENT_MERCHANT_ID,
    }
    if settings.IDPAY_SANDBOX:
        headers["X-SANDBOX"] = "1"
    return headers


def _mock_gateway_url(
    *,
    callback_url: str,
    authority: str,
    order_id: str,
    amount: int,
    payment_id: int | None,
) -> str:
    parts = urlsplit(callback_url)
    base = urlunsplit((parts.scheme, parts.netloc, "/payments/mock/", "", ""))
    query = {
        "authority": authority,
        "order_id": order_id,
        "amount": str(amount),
        "callback": callback_url,
    }
    if payment_id is not None:
        query["payment_id"] = str(payment_id)
    return f"{base}?{urlencode(query)}"


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers=_idpay_headers())
    try:
        with urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body or "{}")
    except HTTPError as exc:
        body = exc.read().decode("utf-8") if exc.fp else ""
        payload = {}
        if body:
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {"raw": body}
        raise PaymentGatewayError(
            payload.get("error_message", "Gateway request failed"),
            code=payload.get("error_code", exc.code),
            payload=payload or body,
        ) from exc
    except URLError as exc:
        raise PaymentGatewayError("Gateway unavailable", payload=str(exc)) from exc


def _stripe_setup():
    if not settings.STRIPE_SECRET_KEY:
        raise PaymentGatewayError("Stripe secret key is not configured.")
    stripe.api_key = settings.STRIPE_SECRET_KEY


def _stripe_callback_url(base_url: str, status_value: str) -> str:
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}status={status_value}&session_id={{CHECKOUT_SESSION_ID}}"


def _stripe_charge_amount(amount: int) -> int:
    currency = (settings.STRIPE_CURRENCY or "usd").lower()
    if currency == "usd":
        rials_per_usd = 1_000_000
        base_cents = int(round((int(amount) * 100) / rials_per_usd))
        fee_cents = 50
        # Stripe minimum is at least $0.50 in settlement currency; use $1.00 to be safe across conversions.
        return max(100, base_cents + fee_cents)
    return int(amount)


def _stripe_request(
    *,
    amount: int,
    description: str,
    callback_url: str,
    order_id: str | None,
    metadata: dict[str, Any] | None,
) -> PaymentRequestResult:
    _stripe_setup()
    currency = settings.STRIPE_CURRENCY or "usd"
    charge_amount = _stripe_charge_amount(amount)
    if charge_amount < 50:
        raise PaymentGatewayError("Stripe minimum charge is $0.50 (50 cents). Increase the IRR amount.")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[
                {
                    "price_data": {
                        "currency": currency,
                        "product_data": {"name": description or "Payment"},
                        "unit_amount": int(charge_amount),
                    },
                    "quantity": 1,
                }
            ],
            success_url=_stripe_callback_url(callback_url, "success"),
            cancel_url=_stripe_callback_url(callback_url, "cancel"),
            client_reference_id=order_id or None,
            metadata=metadata or {},
        )
    except stripe.error.StripeError as exc:
        message = getattr(exc, "user_message", None) or str(exc)
        raise PaymentGatewayError(message) from exc
    return PaymentRequestResult(authority=session.id, payment_url=session.url, raw=session)


def _stripe_verify(*, authority: str, amount: int) -> PaymentVerifyResult:
    _stripe_setup()
    try:
        session = stripe.checkout.Session.retrieve(authority)
        paid = session.payment_status == "paid"
        total = session.amount_total or 0
        if int(total) != int(_stripe_charge_amount(amount)):
            paid = False
        ref = session.payment_intent or session.id or ""
        return PaymentVerifyResult(ok=paid, ref_id=str(ref), raw=session, code=200 if paid else 400)
    except stripe.error.StripeError as exc:
        message = getattr(exc, "user_message", None) or str(exc)
        raise PaymentGatewayError(message) from exc


def request_payment(
    *,
    amount: int,
    description: str,
    callback_url: str,
    order_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PaymentRequestResult:
    if settings.PAYMENT_GATEWAY == "stripe":
        if not settings.STRIPE_SECRET_KEY:
            authority = uuid.uuid4().hex
            payment_id = None
            if metadata and "payment_id" in metadata:
                try:
                    payment_id = int(metadata["payment_id"])
                except (TypeError, ValueError):
                    payment_id = None
            mock_order_id = order_id or uuid.uuid4().hex
            return PaymentRequestResult(
                authority=authority,
                payment_url=_mock_gateway_url(
                    callback_url=callback_url,
                    authority=authority,
                    order_id=mock_order_id,
                    amount=amount,
                    payment_id=payment_id,
                ),
                raw={"mock": True, "authority": authority},
                mock=True,
            )
        return _stripe_request(
            amount=amount,
            description=description,
            callback_url=callback_url,
            order_id=order_id,
            metadata=metadata,
        )
    api_key = settings.IDPAY_API_KEY or settings.PAYMENT_MERCHANT_ID
    if not api_key:
        authority = uuid.uuid4().hex
        payment_id = None
        if metadata and "payment_id" in metadata:
            try:
                payment_id = int(metadata["payment_id"])
            except (TypeError, ValueError):
                payment_id = None
        mock_order_id = order_id or uuid.uuid4().hex
        return PaymentRequestResult(
            authority=authority,
            payment_url=_mock_gateway_url(
                callback_url=callback_url,
                authority=authority,
                order_id=mock_order_id,
                amount=amount,
                payment_id=payment_id,
            ),
            raw={"mock": True, "authority": authority},
            mock=True,
        )
    meta = metadata or {}
    payload = {
        "order_id": order_id or uuid.uuid4().hex,
        "amount": int(amount),
        "desc": description,
        "callback": callback_url,
    }
    if meta.get("name"):
        payload["name"] = meta["name"]
    if meta.get("phone"):
        payload["phone"] = meta["phone"]
    if meta.get("mail"):
        payload["mail"] = meta["mail"]
    result = _post_json("https://api.idpay.ir/v1.1/payment", payload)
    if "id" not in result or "link" not in result:
        raise PaymentGatewayError(
            result.get("error_message", "Payment request rejected"),
            code=result.get("error_code"),
            payload=result,
        )
    return PaymentRequestResult(
        authority=str(result.get("id")),
        payment_url=str(result.get("link")),
        raw=result,
    )


def verify_payment(*, authority: str, amount: int, order_id: str) -> PaymentVerifyResult:
    if settings.PAYMENT_GATEWAY == "stripe":
        if not settings.STRIPE_SECRET_KEY:
            return PaymentVerifyResult(ok=True, ref_id=f"MOCK-{authority[:8]}", raw={"mock": True}, mock=True, code=100)
        return _stripe_verify(authority=authority, amount=amount)
    api_key = settings.IDPAY_API_KEY or settings.PAYMENT_MERCHANT_ID
    if not api_key:
        return PaymentVerifyResult(ok=True, ref_id=f"MOCK-{authority[:8]}", raw={"mock": True}, mock=True, code=100)
    payload = {"id": authority, "order_id": order_id}
    result = _post_json("https://api.idpay.ir/v1.1/payment/verify", payload)
    status_code = result.get("status")
    ok = status_code in (100, 101, 200)
    ref_id = str(result.get("track_id") or result.get("id") or "")
    return PaymentVerifyResult(ok=ok, ref_id=ref_id, raw=result, code=status_code)
