"""Explicit request validation and JSON output contracts."""

import math
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = data.keys() - self.fields.keys()
            if unknown:
                raise serializers.ValidationError(
                    {key: ["Unknown field."] for key in sorted(unknown)}
                )
        return super().to_internal_value(data)


class FiniteFloatField(serializers.FloatField):
    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        value = super().to_internal_value(data)
        if not math.isfinite(value):
            self.fail("invalid")
        return value


class OffsetDateTimeField(serializers.DateTimeField):
    default_error_messages = {
        "offset": (
            "Use an ISO datetime with a timezone offset, "
            "for example 2026-10-03T08:00:00-05:00."
        )
    }

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("offset")
        try:
            value = parse_datetime(data)
        except ValueError:
            value = None
        if value is None or timezone.is_naive(value):
            self.fail("offset")
        return value.replace(second=0, microsecond=0)


def default_start() -> datetime:
    return timezone.now().replace(second=0, microsecond=0)


class LocationSerializer(StrictSerializer):
    label = serializers.CharField(max_length=300)
    lat = FiniteFloatField(min_value=-90, max_value=90, required=False)
    lng = FiniteFloatField(min_value=-180, max_value=180, required=False)

    def validate(self, attrs):
        if ("lat" in attrs) != ("lng" in attrs):
            raise serializers.ValidationError(
                "Supply both latitude and longitude, or neither."
            )
        return attrs


class CarrierSerializer(StrictSerializer):
    name = serializers.CharField(max_length=160, default="Demo Freight LLC")
    address = serializers.CharField(max_length=300, default="Chicago, IL")


def default_carrier() -> dict:
    return {"name": "Demo Freight LLC", "address": "Chicago, IL"}


class TripRequestSerializer(StrictSerializer):
    current_location = LocationSerializer()
    pickup_location = LocationSerializer()
    dropoff_location = LocationSerializer()
    cycle_used_hours = FiniteFloatField(min_value=0, max_value=70)
    start_time = OffsetDateTimeField(required=False, default=default_start)
    carrier = CarrierSerializer(required=False, default=default_carrier)
    vehicle = serializers.CharField(max_length=160, default="Truck 101 / Trailer 201")
    shipping_doc = serializers.CharField(
        max_length=200, default="DEMO-001 / General freight"
    )
    driver_name = serializers.CharField(max_length=160, default="Demo Driver")


class AutocompleteQuerySerializer(StrictSerializer):
    q = serializers.CharField(max_length=300, allow_blank=True, default="")


class SuggestionSerializer(serializers.Serializer):
    label = serializers.CharField()
    lat = serializers.FloatField()
    lng = serializers.FloatField()


class LegSerializer(serializers.Serializer):
    from_place = serializers.CharField(source="from")
    to_place = serializers.CharField(source="to")
    miles = serializers.FloatField()

    def to_representation(self, instance):
        result = super().to_representation(instance)
        result["from"] = result.pop("from_place")
        result["to"] = result.pop("to_place")
        return result


class RouteSerializer(serializers.Serializer):
    geometry = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField())
    )
    total_miles = serializers.FloatField()
    legs = LegSerializer(many=True)
    provider = serializers.CharField()
    profile = serializers.CharField()
    provider_duration_hours = serializers.FloatField()
    attribution = serializers.ListField(child=serializers.CharField())


class SummarySerializer(serializers.Serializer):
    total_miles = serializers.FloatField()
    total_driving_hours = serializers.FloatField()
    total_duration_hours = serializers.FloatField()
    log_days = serializers.IntegerField()
    fuel_stops = serializers.IntegerField()
    rests = serializers.IntegerField()
    breaks = serializers.IntegerField()
    restarts = serializers.IntegerField()
    cycle_remaining_hours_at_end = serializers.FloatField()


class EventSerializer(serializers.Serializer):
    id = serializers.CharField()
    type = serializers.CharField()
    status = serializers.CharField()
    # Strings preserve the departure's offset instead of DRF normalizing to UTC.
    start = serializers.CharField()
    end = serializers.CharField()
    duration_min = serializers.IntegerField()
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    place = serializers.CharField()
    mile_marker = serializers.FloatField()
    end_mile_marker = serializers.FloatField()
    note = serializers.CharField()


class TripResponseSerializer(serializers.Serializer):
    route = RouteSerializer()
    summary = SummarySerializer()
    events = EventSerializer(many=True)
    logs = serializers.ListField(child=serializers.DictField())
    warnings = serializers.ListField(child=serializers.CharField())
    log_generation_available = serializers.BooleanField()
