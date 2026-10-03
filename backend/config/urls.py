"""Public JSON endpoints; canonical paths have no trailing slash."""

from django.urls import path
from trips.views import autocomplete_view, health_view, plan_view

urlpatterns = [
    path("api/health", health_view),
    path("api/geocode/autocomplete", autocomplete_view),
    path("api/trips/plan", plan_view),
]
