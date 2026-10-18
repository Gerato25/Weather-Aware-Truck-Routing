# Weather-Aware Truck Routing

A React + Django app that helps a truck driver pick the **safest** of three routes by scoring forecast weather at timed checkpoints against load weight.

The UI shows every route on a map, risk-colored checkpoints with ETAs, a ranked recommendation, and a corridor weather heatmap with a **0–48 hour** slider that scrubs locally (no refetch per tick).

## What the app does

1. The driver enters origin, destination, departure time, load weight, and checkpoint spacing (10 / 25 / 50 miles).
2. The API fetches **up to three distinct routes** (OpenRouteService truck profile when a key is set, otherwise public OSRM, with forced detours if the router only returns one or two).
3. Checkpoints are sampled along each geometry. The truck's **ETA at each checkpoint** comes from the provider's per-segment travel times, not a flat average speed.
4. Open-Meteo hourly wind / rain / snow is interpolated to that ETA and classified with the risk table and load rules below.
5. Routes are ranked, then drawn on the map with a corridor heatmap for the selected route.

## Risk rules

Wind, rain, and snow are classified independently; the checkpoint takes the **worst** of the three. Shared band endpoints follow the printed table (rain of 0.25 in/hr is Moderate).

| Condition | Low | Moderate | High | Severe | No Travel |
| --- | --- | --- | --- | --- | --- |
| Wind | < 25 mph | 25–34 | 35–44 | 45–54 | ≥ 55 mph |
| Rain | < 0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| Snow | < 0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

Load overrides (applied to the wind figure actually used — by default the worse of sustained and gust):

- ≥ 55 mph → **No Travel** for any load
- 45–54 mph **and** load > 30,000 lb → **No Travel**
- 35–44 mph **and** load > 40,000 lb → **Severe**

### Recommendation order

1. Fewest **No Travel** miles (a forbidden stretch never beats a legal one)
2. Fewest **Severe** miles
3. Fewest **High** miles
4. Lowest distance-weighted average risk
5. Shortest travel time

## Architecture

```
React (Vite + MapLibre GL)  →  Django REST  →  OSRM / OpenRouteService
                                            →  Nominatim / Pelias
                                            →  Open-Meteo
```

| Piece | Why |
| --- | --- |
| **OSRM** (zero-key fallback) | Alternative routes + per-edge duration annotations for accurate ETAs |
| **OpenRouteService** (optional key) | Real `driving-hgv` truck profile with the entered load as a weight restriction |
| **Open-Meteo** | No key; batch multi-point hourly forecasts already in mph / inches |
| **MapLibre + CARTO Dark Matter** | Vector map, no map-token required |
| **Heatmap slider** | Each corridor point carries `h0…h48` properties; the slider only swaps a paint expression |

The Django process is **stateless** (no database). Forecasts are cached in memory for 15 minutes so repeated plans along the same corridor do not hammer Open-Meteo.

## Local setup

Requires Python 3.13+ and Node 20+.

```powershell
# 1. Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env   # optional
python backend\manage.py test trucking
python backend\manage.py runserver 127.0.0.1:8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies `/api` to Django.

Optional: set `OPENROUTESERVICE_API_KEY` in `backend/.env` for truck-legal routing. Free key: [openrouteservice.org/dev](https://openrouteservice.org/dev/#/signup).

**Good demo trip:** Chicago, IL → Denver, CO, ~2 hours from now, **42,000 lb**, 25-mile checkpoints. The three corridors often disagree on weather, so the recommendation is not simply “the fastest one.”

## Tests

```powershell
.\.venv\Scripts\python.exe backend\manage.py test trucking
```

81 tests cover band edges, load-rule escalation, ETA interpolation, mileage rollups, ranking ties, corridor expansion, and API validation. They do not hit the network.

Live smoke test (hits OSRM + Open-Meteo):

```powershell
.\.venv\Scripts\python.exe backend\smoke_test.py "Chicago, IL" "Philadelphia, PA" 42000 25
```

## Docker / production

```powershell
docker compose up --build
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). Gunicorn serves the API and the Vite build from one process.

### Host on Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo (`render.yaml`).
3. Optionally paste an OpenRouteService key into `OPENROUTESERVICE_API_KEY`.
4. After deploy, the public URL is the hosted app. Health check: `/api/health/`.

Free-tier cold starts can take a minute; the first plan after idle may wait on OSRM’s public server as well.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health/` | Liveness + which router is active |
| `GET` | `/api/rules/` | Risk table (keeps the UI legend honest) |
| `GET` | `/api/geocode/?q=` | Place search |
| `POST` | `/api/plan/` | Three scored routes + recommendation |
| `POST` | `/api/corridor/` | 0–48 h heatmap grid for the selected route |

`POST /api/plan/` body:

```json
{
  "origin": "Chicago, IL",
  "destination": { "lat": 39.7392, "lon": -104.9903, "label": "Denver, CO" },
  "departure": "2026-10-18T12:00:00Z",
  "load_lb": 42000,
  "interval_miles": 25
}
```

`interval_miles` must be `10`, `25`, or `50`.

## Loom walkthrough (5–10 min)

Suggested outline for the required recording:

1. **Problem (30 s)** — A loaded truck cannot treat “shortest” as “safest”; wind and precip at *arrival time* along the corridor matter.
2. **Form (1 min)** — Origin / destination autocomplete, departure, 42k lb load (crosses both load-rule thresholds), 25-mile sampling.
3. **Routes (2 min)** — Three polylines, click each card, stacked risk bar, recommendation table (Severe → High → average → time).
4. **Checkpoints (2 min)** — Click a High/Severe dot; show ETA, wind/gusts/rain/snow, and the reason string. Toggle “Only show above Low.”
5. **Heatmap (2 min)** — Play the 0–48 h slider; switch Wind / Rain / Snow; note that scrubbing does not refetch.
6. **Load rules (1 min)** — Re-plan the same trip at 15,000 lb vs 42,000 lb and show the ranking change if a 45–54 mph stretch is present.
7. **Code tour (1–2 min)** — `backend/trucking/risk.py` (table + load rules), `planner.py` (ranking key), `frontend/src/components/MapView.tsx` (heatmap paint swap).

## Project layout

```
backend/trucking/
  risk.py          risk table + load rules
  geo.py           timed route profile + checkpoint sampling
  planner.py       orchestration + ranking
  corridor.py      0–48 h heatmap grid
  weather/         Open-Meteo batch client
  providers/       OSRM, OpenRouteService, Nominatim
frontend/src/
  components/      map, form, cards, heatmap slider
  api/client.ts    typed fetch wrapper
```
