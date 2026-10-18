"""Shared HTTP session with retries for all upstream provider calls."""

from __future__ import annotations

import threading

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_local = threading.local()


class UpstreamError(Exception):
    """An upstream provider failed in a way the user should hear about."""

    def __init__(
        self,
        message: str,
        *,
        provider: str = "",
        status: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.status = status
        self.retry_after = retry_after


def get_session() -> requests.Session:
    """One pooled session per thread, with retry/backoff on transient failures."""
    session = getattr(_local, "session", None)
    if session is not None:
        return session

    session = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=2,
        backoff_factor=0.6,
        # 429 is handled by the Open-Meteo client with a process-wide lock so
        # concurrent retries cannot amplify the rate limit.
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=32)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({"User-Agent": settings.USER_AGENT, "Accept": "application/json"})

    _local.session = session
    return session


def request_json(
    method: str,
    url: str,
    *,
    provider: str,
    params: dict | None = None,
    json_body: dict | None = None,
    headers: dict | None = None,
    timeout: float | None = None,
):
    """Perform a request and return parsed JSON, normalising upstream errors."""
    try:
        response = get_session().request(
            method,
            url,
            params=params,
            json=json_body,
            headers=headers,
            timeout=timeout or settings.HTTP_TIMEOUT_SECONDS,
        )
    except requests.Timeout as exc:
        raise UpstreamError(f"{provider} timed out", provider=provider) from exc
    except requests.RequestException as exc:
        raise UpstreamError(f"Could not reach {provider}", provider=provider) from exc

    if response.status_code >= 400:
        detail = _extract_error(response)
        raise UpstreamError(
            f"{provider} returned {response.status_code}: {detail}",
            provider=provider,
            status=response.status_code,
            retry_after=_retry_after_seconds(response),
        )

    try:
        return response.json()
    except ValueError as exc:
        raise UpstreamError(f"{provider} returned a malformed response", provider=provider) from exc


def _retry_after_seconds(response: requests.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def _extract_error(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return (response.text or "")[:200]

    if isinstance(payload, dict):
        for key in ("message", "error", "detail", "reason"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
            if isinstance(value, dict) and isinstance(value.get("message"), str):
                return value["message"]
    return str(payload)[:200]
