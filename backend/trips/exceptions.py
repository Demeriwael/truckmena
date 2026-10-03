"""Safe public errors; upstream messages, URLs, and credentials stay private."""

import logging

from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class ProviderUnavailable(APIException):
    status_code = 502
    default_detail = "The map provider is unavailable. Please try again shortly."
    default_code = "provider_unavailable"


class AddressNotFound(APIException):
    status_code = 400
    default_detail = "Address not found. Use a complete address or select a suggestion."
    default_code = "address_not_found"


class NoRoute(APIException):
    status_code = 400
    default_detail = (
        "No road route connects these locations. Choose reachable addresses."
    )
    default_code = "no_route"


class SameLocations(APIException):
    status_code = 400
    default_detail = "Pickup and dropoff must be different locations."
    default_code = "same_locations"


class InvalidStartTime(APIException):
    status_code = 400
    default_detail = (
        "This trip extends beyond the supported calendar. Choose an earlier start time."
    )
    default_code = "invalid_start_time"


def api_exception_handler(exc: Exception, context: dict) -> Response:
    response = exception_handler(exc, context)
    if response is None:
        # Exception text/tracebacks may contain a provider URL or credential.
        logger.error("Trip API failed (%s)", type(exc).__name__)
        return Response(
            {
                "detail": "Unable to plan this trip. Please try again.",
                "code": "internal_error",
            },
            status=500,
        )
    if (
        isinstance(exc, APIException)
        and isinstance(response.data, dict)
        and "detail" in response.data
    ):
        response.data["code"] = exc.default_code
    return response
