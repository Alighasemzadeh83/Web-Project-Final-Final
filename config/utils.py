from typing import Any, Optional

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def drf_exception_handler(exc: Exception, context: dict[str, Any]) -> Optional[Response]:
    """
    Wrap DRF's default handler to enforce a consistent error shape:
    {"error": {"code": "<class_name>", "message": "...", "details": {...}}}
    """
    response = exception_handler(exc, context)
    if response is None:
        return response

    code = exc.__class__.__name__
    message = ""
    details: Any = response.data

    if isinstance(response.data, dict):
        message = response.data.get("detail") or response.data.get("message") or ""

    # Move the entire body into details to keep a consistent envelope
    status_text = getattr(response, "status_text", "")
    payload = {
        "error": {
            "code": code,
            "message": message or status_text,
            "details": details,
        }
    }
    response.data = payload
    return response
