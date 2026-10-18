"""Selects which upstream providers to use based on configured credentials."""

from __future__ import annotations

import logging

from django.conf import settings

from ..http import UpstreamError
from .geocoding import ChainedGeocoder, NominatimGeocoder, PeliasGeocoder
from .ors import OpenRouteServiceProvider
from .osrm import OSRMProvider

logger = logging.getLogger(__name__)


def get_router():
    """OpenRouteService when a key is present, otherwise the OSRM demo server."""
    if settings.OPENROUTESERVICE_API_KEY:
        try:
            return OpenRouteServiceProvider()
        except UpstreamError:
            logger.warning("OpenRouteService key rejected at startup; falling back to OSRM")
    return OSRMProvider()


def get_fallback_router():
    """Secondary router used if the primary fails mid-request."""
    if settings.OPENROUTESERVICE_API_KEY:
        return OSRMProvider()
    return None


def get_geocoder():
    geocoders = []
    if settings.OPENROUTESERVICE_API_KEY:
        try:
            geocoders.append(PeliasGeocoder())
        except UpstreamError:
            pass
    geocoders.append(NominatimGeocoder())
    return ChainedGeocoder(geocoders)
