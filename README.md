# Weather-Aware Truck Routing

Take-home app for a truck driver: enter a trip, get **three routes**, score **wind / rain / snow at each checkpoint’s truck ETA**, and pick the safest corridor for the load.

- **Hosted app (Render):** [weather-aware-truck-routing-1hp9.onrender.com](https://weather-aware-truck-routing-1hp9.onrender.com/)
- **GitHub:** [Gerato25/Weather-Aware-Truck-Routing](https://github.com/Gerato25/Weather-Aware-Truck-Routing)

---

## Assessment requirements

What the guide asks for, and where it lives in this app.

| Guide | This app |
| --- | --- |
| Origin, destination, departure time, load weight | Trip Planner form (`/plan`) |
| Three route options | OSRM alternatives (OpenRouteService HGV if a key is set) |
| Sample weather every **10 / 25 / 50** miles | `interval_miles` on `POST /api/plan/` |
| Weather at the **truck’s ETA**, not a flat speed | Per-edge travel times → checkpoint ETA → Open-Meteo hour |
| Risk table + load rules | `backend/trucking/risk.py` and the planner legend |
| Recommend: fewest Severe miles → fewest High miles → lowest average risk → shortest time | Ranking key in `backend/trucking/planner.py` (No Travel miles first, then the guide order) |
| Map of the routes | MapLibre, all three corridors on one map |
| Weather heatmap, **0–48 hour** slider | Corridor overlay; slider scrubs already-fetched hours |
| GitHub repo | [Gerato25/Weather-Aware-Truck-Routing](https://github.com/Gerato25/Weather-Aware-Truck-Routing) |
| Hosted app | [Render](https://weather-aware-truck-routing-1hp9.onrender.com/) |
| 5–10 min Loom | outline below; you record it |

---

## Inputs

On **Trip Planner**:

- Origin
- Destination
- Departure time
- Load (lb)
- Checkpoint spacing: **10**, **25**, or **50** miles

Autocomplete geocodes to lat/lon. Risk uses those coordinates and the ETA at each stop.

---

## Routes

The API returns **up to three distinct routes** (A / B / C) with distance, drive time, and arrival.

- Default router: public **OSRM** alternatives
- Optional: `OPENROUTESERVICE_API_KEY` for a truck (`driving-hgv`) profile and the entered weight

---

## Weather sampling

Along each geometry the planner drops checkpoints every 10 / 25 / 50 miles and **always includes the destination**.

For each checkpoint:

1. Truck ETA = departure + summed segment times (not average mph)
2. Open-Meteo hourly wind, gust, rain, snow, temp at that **lat/lon**
3. Values interpolated to the ETA (mph and in/hr)
4. Checkpoint risk = worst of wind, rain, and snow, then load rules

**Demo weather** is off unless you check the box. Off = live Open-Meteo. On = scripted storms for a Loom. If Open-Meteo is rate-limited, the UI says so and does **not** invent storms.

---

## Risk table

From the assessment. Shared endpoints stay in the lower band (rain **0.25** in/hr is Moderate).

| Condition | Low | Moderate | High | Severe | No Travel |
| --- | --- | --- | --- | --- | --- |
| Wind | < 25 mph | 25–34 | 35–44 | 45–54 | ≥ 55 mph |
| Rain | < 0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | > 1.00 |
| Snow | < 0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | > 3.0 |

Wind used for the table is `max(sustained, gust)` (`WIND_RISK_METRIC=max`). Both numbers still show on the checkpoint card.

### Load rules

- ≥ 55 mph wind → **No Travel** at any weight
- 45–54 mph and load > 30,000 lb → **No Travel**
- 35–44 mph and load > 40,000 lb → **Severe**

Default demo load is **42,000 lb** (just over 40,000 lb).

---

## Recommendation

Assignment order:

1. Fewest **Severe** miles
2. Fewest **High** miles
3. Lowest distance-weighted **average risk**
4. Shortest **travel time**

This build also ranks **fewest No Travel miles first**, so a forbidden stretch cannot beat a legal one. Then the four guide keys apply.

---

## Map and 0–48h heatmap

- All three routes on one map
- Route color = risk at the **slider hour** (Low / Moderate / High / Severe / No Travel)
- Checkpoint cards list Severe / High / Low miles
- Click a stop: **ETA** weather (what the truck meets) and **this location · +Xh** (slider hour)
- Heatmap tabs: Risk / Wind / Rain / Snow
- Slider **0–48h** plays already-downloaded corridor hours (no refetch per tick)

ETA scores do not change when you move the slider.

---

## Run locally

Python 3.12+ and Node 20+. Use **two terminals**. Leave both running.

`python manage.py` by itself only prints Django’s command list. You must pass **`runserver`**.

### Terminal 1 — API

```powershell
cd backend
python -m pip install -r requirements.txt
python manage.py runserver 8000
```

Success looks like: `Starting development server at http://127.0.0.1:8000/`.

### Terminal 2 — UI

```powershell
cd frontend
npm install
npm run dev
```

Success looks like Vite on [http://127.0.0.1:5173](http://127.0.0.1:5173). Open that URL → **Trip Planner** (`/plan`). Vite proxies `/api` to Django on port 8000.

Optional: `OPENROUTESERVICE_API_KEY` in `backend/.env` ([free key](https://openrouteservice.org/dev/#/signup)).

### Trip to show the grader

**Los Angeles, CA → San Francisco, CA**, **42,000 lb**, **25 mi** checkpoints, **Demo unchecked**.

Leave this evening so the ~7h haul is still on I-5 / CA-99 / US-101 when live SoCal rain starts. Confirm the line under the form: `Weather source: live Open-Meteo…`.

---

## Tests

```powershell
cd backend
python manage.py test trucking
```

Covers band edges, load rules, missing weather, ETA interpolation, mileage rollups, ranking, and corridor grid. No network.

---

## Hosted app

Live on Render (API + UI in one Docker service):

**https://weather-aware-truck-routing-1hp9.onrender.com/**

Health: `/api/health/`. Free-tier cold start can take about a minute.

Redeploy: push this repo; Render uses `render.yaml`. Optional env: `OPENROUTESERVICE_API_KEY`.

---

## Loom (5–10 min)

1. **Problem** — Shortest is not safest; weather at *arrival time* along the corridor matters.
2. **Form** — Origin, destination, departure, 42,000 lb, 25-mile sampling. Demo **off**.
3. **Three routes** — A / B / C on the map; distance, time, Severe / High miles.
4. **Recommendation** — Fewest Severe → High → average risk → time (No Travel first if any).
5. **Checkpoints** — Click a stop. ETA after departure, wind vs gust, rain/snow, risk meters.
6. **Heatmap** — 0–48h slider; Risk / Wind / Rain / Snow. Slider hour ≠ ETA.
7. **Code** — `backend/trucking/risk.py` (table + load), `planner.py` (ranking), `frontend/src/components/MapView.tsx` (map + slider).

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health/` | Liveness |
| `GET` | `/api/rules/` | Risk table |
| `GET` | `/api/geocode/?q=` | Place search |
| `POST` | `/api/plan/` | Three scored routes + recommendation |
| `POST` | `/api/corridor/` | 0–48h heatmap grid |

```json
{
  "origin": "Los Angeles, CA",
  "destination": "San Francisco, CA",
  "departure": "2026-10-21T20:16:00Z",
  "load_lb": 42000,
  "interval_miles": 25
}
```

`interval_miles` must be `10`, `25`, or `50`.
