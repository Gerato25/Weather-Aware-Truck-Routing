from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.urls import include, path, re_path
from django.views.decorators.http import require_GET


@require_GET
def spa(_request):
    """Serve the Vite index.html so the UI and API share one origin."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        return JsonResponse(
            {
                "detail": "Frontend build is missing. Run `npm run build` in frontend/ "
                "or start the Vite dev server on port 5173."
            },
            status=503,
        )
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/", include("trucking.urls")),
    path("", spa, name="spa"),
    # Any non-API path falls through to the SPA so a refresh on a deep link
    # still loads the app. Vite's hashed assets are served by WhiteNoise first.
    re_path(r"^(?!api/).+$", spa),
]
