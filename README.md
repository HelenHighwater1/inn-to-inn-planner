# Speyside Way — Inn-to-Inn Planner

An interactive planner for hiking the [Speyside Way](https://www.speysideway.org/) in Scotland, inn to inn. Pick your overnight stops on the map and it builds a day-by-day itinerary with distances, climbing, and lodging/food options along the route.

Built with React, TypeScript, Vite, and [MapLibre GL](https://maplibre.org/). All map and POI data comes from OpenStreetMap — no Google APIs required.

## Features

- Interactive map of the full Speyside Way (Buckie to Newtonmore) with a custom muted MapLibre style
- Add stops from a town or inn popup on the map (or the + Add picker); drag numbered pins to adjust them
- Per-day itinerary cards with distance, elevation gain, and lunch-stop counts
- POI layers for towns, lodging, food, and distilleries — enriched with website links, images (OSM / Wikimedia / Wikipedia / site metadata), and contact info
- Pick lodging and lunch straight from map popups: a hotel within ~3 km of a stop becomes that stop's lodging (replacing any earlier pick, with a nights stepper) instead of adding a new stop — includes manually added off-trail options (`data/manual-pois.json`); a food spot in the middle 50% of a day can be chosen as that day's lunch
- Miles/feet ↔ km/meters unit toggle
- Itinerary state persists in the URL hash (shareable links)

## Development

```sh
npm install
npm run dev      # start dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
```

## Data pipeline

Trail and POI data are pre-generated into `src/data/` so the app is fully static. Raw API responses are cached in `data/raw/` — re-run with `--refetch` to update them.

```sh
node scripts/fetch-trail.mjs   # OSM relation 1026251 -> src/data/trail.json
node scripts/fetch-pois.mjs    # Overpass POIs near trail -> src/data/pois.json
```

Data sources: [OpenStreetMap](https://www.openstreetmap.org/) (© OSM contributors, ODbL), [Overpass API](https://overpass-api.de/), [OpenTopoData](https://www.opentopodata.org/) for elevation, Wikimedia/Wikipedia for images, and [OpenFreeMap](https://openfreemap.org/) for basemap tiles.
