"""Thin JSON views: validate input, call a service, serialize output."""

from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from trips.serializers import (
    AutocompleteQuerySerializer,
    SuggestionSerializer,
    TripRequestSerializer,
    TripResponseSerializer,
)
from trips.services.geocoding import autocomplete
from trips.services.planner import plan_trip


@api_view(["GET"])
@throttle_classes([])
def health_view(request):
    return Response({"status": "ok", "service": "eld-trip-planner"})


@api_view(["GET"])
def autocomplete_view(request):
    serializer = AutocompleteQuerySerializer(data=request.query_params.dict())
    serializer.is_valid(raise_exception=True)
    results = autocomplete(serializer.validated_data["q"])
    return Response(SuggestionSerializer(results, many=True).data)


@api_view(["POST"])
def plan_view(request):
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    result = plan_trip(serializer.validated_data)
    return Response(TripResponseSerializer(result).data)


autocomplete_view.cls.throttle_scope = "autocomplete"
plan_view.cls.throttle_scope = "plan"
