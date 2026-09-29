import { useEffect, useRef, useState } from 'react';
import {
  GeoJSONSource,
  Map as MLMap,
  MapMouseEvent,
  Marker,
  Popup,
  setWorkerUrl,
  type LngLatBoundsLike,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  fmtDistM,
  kmAt,
  lunchPois,
  nearestOnTrail,
  POIS,
  positionAt,
  TRAIL,
  trailSlice,
  type Poi,
  type Stop,
} from '../lib/trail';
import { deriveDays, deriveSegments } from '../lib/itinerary';
import { usePlanner } from '../store';
import { AMBER, COPPER, COPPER_TEXT, dayColor, HEATHER, PAPER, PIN_FILL, SKIPPED } from '../lib/colors';
import { MAP_STYLE } from '../lib/mapStyle';

// The bundled entry doesn't sit next to maplibre-gl-worker.mjs, so the
// default sibling-path lookup 404s in production builds.
setWorkerUrl(maplibreWorkerUrl);

/** Amber diamond image for food POIs (circles can't do diamonds). */
function makeDiamond(): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 44;
  const ctx = c.getContext('2d')!;
  ctx.translate(22, 22);
  ctx.rotate(Math.PI / 4);
  const s = 15;
  ctx.fillStyle = AMBER;
  ctx.strokeStyle = '#FBF9F4';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(-s / 2, -s / 2, s, s);
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, c.width, c.height);
}

const trailBounds = (): LngLatBoundsLike => {
  const lons = TRAIL.map(p => p.lon);
  const lats = TRAIL.map(p => p.lat);
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
};

/** Day number (as shown in the sidebar) for each segment key. */
function dayNumBySeg(): Map<string, number> {
  const { stops, restAt, skipped } = usePlanner.getState();
  const map = new Map<string, number>();
  let n = 0;
  for (const d of deriveDays(stops, restAt, skipped)) {
    n++;
    if (d.type !== 'rest') map.set(d.seg.key, n);
  }
  return map;
}

/** Lodging within this along-trail distance of a stop is offered as that night's lodging, not a new stop. */
const LODGING_SNAP_KM = 3;

function nearestStop(stops: Stop[], trailIdx: number, maxKm: number): Stop | null {
  const km = kmAt(trailIdx);
  let best: Stop | null = null;
  let bestD = maxKm;
  for (const s of stops) {
    const d = Math.abs(kmAt(s.trailIdx) - km);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** First night spent at a stop (the day ending there); undefined for the trailhead. */
function firstNightAt(stopId: string): number | undefined {
  const { stops, restAt, skipped } = usePlanner.getState();
  const i = deriveDays(stops, restAt, skipped).findIndex(
    d => (d.type === 'rest' ? d.stop.id : d.seg.to.id) === stopId,
  );
  return i < 0 ? undefined : i + 1;
}

/** "night 2", "nights 2–3", or "the night before day 1" for the trailhead. */
function fmtNights(first: number | undefined, count: number): string {
  if (first === undefined) return 'the night before day 1';
  return count === 1 ? `night ${first}` : `nights ${first}–${first + count - 1}`;
}

/** The walked leg whose middle 50% contains this food POI (i.e. it's a lunch option for that day). */
function lunchLeg(poiId: string) {
  const { stops, skipped } = usePlanner.getState();
  return (
    deriveSegments(stops, skipped).find(
      s => !s.skipped && lunchPois(s.from.trailIdx, s.to.trailIdx).some(p => p.id === poiId),
    ) ?? null
  );
}

export function TrailMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const popupRef = useRef<Popup | null>(null);
  const [ready, setReady] = useState(false);
  const stops = usePlanner(s => s.stops);
  const restAt = usePlanner(s => s.restAt);
  const skipped = usePlanner(s => s.skipped);
  const showPois = usePlanner(s => s.showPois);
  const selected = usePlanner(s => s.selected);
  const focusSeg = usePlanner(s => s.focusSeg);
  const focusStop = usePlanner(s => s.focusStop);
  const togglePoi = usePlanner(s => s.togglePoi);
  const hoverPois = usePlanner(s => s.hoverPois);

  function showPoiPopup(map: MLMap, poi: Poi) {
    const el = document.createElement('div');
    el.className = 'poi-popup';
    const label = poi.subtype.replaceAll('_', ' ');
    if (poi.imageUrl) {
      const img = document.createElement('img');
      img.src = poi.imageUrl;
      img.alt = poi.name ?? '';
      img.className = 'poi-photo';
      img.onerror = () => img.remove();
      el.appendChild(img);
    }
    const body = document.createElement('div');
    const imp = usePlanner.getState().imperial;
    body.innerHTML = `<div class="poi-name">${poi.name ?? '(unnamed)'}</div><div class="muted">${label} · ${fmtDistM(poi.distToTrailM, imp)} from trail</div>`;
    if (poi.website) {
      const a = document.createElement('a');
      a.href = poi.website;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = /facebook\.com/.test(poi.website) ? 'facebook' : 'website';
      a.className = 'poi-link';
      body.appendChild(a);
    }
    el.appendChild(body);

    const st = usePlanner.getState();
    const action = (label: string, secondary: boolean, run: () => void) => {
      const btn = document.createElement('button');
      btn.className = `poi-add${secondary ? ' secondary' : ''}`;
      btn.textContent = label;
      btn.onclick = () => {
        run();
        popup.remove();
      };
      el.appendChild(btn);
    };
    const addStop = () => st.addStop(poi.trailIdx, poi);
    if (poi.kind === 'accommodation') {
      const stop = nearestStop(st.stops, poi.trailIdx, LODGING_SNAP_KM);
      if (stop) appendStay(el, poi, stop, () => popup.remove());
      else action('Add as overnight stop', false, addStop);
    } else if (poi.kind === 'town') {
      action('Add as overnight stop', false, addStop);
    } else if (poi.kind === 'food') {
      const leg = lunchLeg(poi.id);
      if (leg) {
        const day = dayNumBySeg().get(leg.key);
        if (st.lunch[leg.key] === poi.id)
          action(`Remove as lunch for day ${day}`, true, () => st.setLunch(leg.key, null));
        else action(`Choose for lunch on day ${day}`, false, () => st.setLunch(leg.key, poi.id));
      }
    }

    popupRef.current?.remove();
    const popup = new Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat([poi.lon, poi.lat])
      .setDOMContent(el)
      .addTo(map);
    popupRef.current = popup;
  }

  /** "Stay here" block for a hotel near an existing stop: pick it (replacing any earlier pick) + nights. */
  function appendStay(el: HTMLElement, poi: Poi, stop: Stop, close: () => void) {
    const st = usePlanner.getState();
    const idx = st.stops.findIndex(s => s.id === stop.id);
    const interior = idx > 0 && idx < st.stops.length - 1;
    const chosen = stop.lodgingId === poi.id;
    const current = stop.lodgingId && !chosen ? POIS.find(p => p.id === stop.lodgingId) : null;
    const first = firstNightAt(stop.id);
    let nights = interior ? (st.restAt[stop.id] ?? 0) + 1 : 1;

    const box = document.createElement('div');
    box.className = 'poi-stay';
    const head = document.createElement('div');
    head.className = 'poi-stay-head';
    box.appendChild(head);
    if (current) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = `Replaces ${current.name ?? 'your current pick'}`;
      box.appendChild(note);
    }

    const btn = document.createElement('button');
    btn.className = `poi-add${chosen ? ' secondary' : ''}`;
    const render = () => {
      head.textContent = `${chosen ? 'Your stay in' : 'Stay in'} ${stop.name} · ${fmtNights(first, nights)}`;
      btn.textContent = chosen
        ? 'Remove as lodging'
        : interior
          ? `Stay here for ${nights} night${nights === 1 ? '' : 's'}`
          : 'Stay here';
    };

    if (interior) {
      const row = document.createElement('div');
      row.className = 'poi-nights';
      row.innerHTML = `Nights
        <button class="n-btn" data-d="-1" aria-label="Fewer nights">−</button>
        <span class="n-count">${nights}</span>
        <button class="n-btn" data-d="1" aria-label="More nights">+</button>`;
      row.querySelectorAll<HTMLButtonElement>('.n-btn').forEach(b =>
        b.addEventListener('click', () => {
          nights = Math.max(1, nights + Number(b.dataset.d));
          row.querySelector('.n-count')!.textContent = `${nights}`;
          if (chosen) usePlanner.getState().setRestDays(stop.id, nights - 1);
          render();
        }),
      );
      box.appendChild(row);
    }

    btn.onclick = () => {
      const s = usePlanner.getState();
      if (chosen) s.setLodging(stop.id, null);
      else {
        s.setLodging(stop.id, poi.id);
        if (interior) s.setRestDays(stop.id, nights - 1);
      }
      close();
    };
    render();
    box.appendChild(btn);
    el.appendChild(box);
  }

  // init map once
  useEffect(() => {
    if (!ref.current) return;
    const markers = markersRef.current;
    const map = new MLMap({
      container: ref.current,
      style: MAP_STYLE,
      center: [-3.4, 57.4],
      zoom: 8,
      attributionControl: { compact: false },
    });
    mapRef.current = map;

    map.on('load', () => {
      map.fitBounds(trailBounds(), { padding: 60 });

      const coords: [number, number][] = TRAIL.map(p => [p.lon, p.lat]);
      map.addSource('trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      });
      map.addSource('segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('segments-skipped', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('detours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('poi-chosen', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('poi-highlight', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      if (!map.hasImage('food-diamond')) map.addImage('food-diamond', makeDiamond(), { pixelRatio: 2 });

      // whole trail, faint, where it isn't a walked day
      map.addLayer({
        id: 'trail-base',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#B9B29F', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 3] },
      });
      // white casing under every day's line
      map.addLayer({
        id: 'segments-casing',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PIN_FILL, 'line-width': 10 },
      });
      map.addLayer({
        id: 'segments-skipped-casing',
        type: 'line',
        source: 'segments-skipped',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PIN_FILL, 'line-width': 8 },
      });
      map.addLayer({
        id: 'segments-skipped-line',
        type: 'line',
        source: 'segments-skipped',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': SKIPPED, 'line-width': 3.5, 'line-dasharray': [3, 2.5] },
      });
      map.addLayer({
        id: 'segments-line',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'sel'], 7, 4.5],
        },
      });
      // foot-routed spurs to off-trail lodging
      map.addLayer({
        id: 'detours-line',
        type: 'line',
        source: 'detours',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': HEATHER, 'line-width': 2.5, 'line-dasharray': [1, 2], 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'trail-hit',
        type: 'line',
        source: 'trail',
        paint: { 'line-width': 24, 'line-opacity': 0 },
      });
      // ring around each stop's chosen lodging
      map.addLayer({
        id: 'poi-chosen',
        type: 'circle',
        source: 'poi-chosen',
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': HEATHER,
          'circle-stroke-width': 2.5,
        },
      });
      map.addLayer({
        id: 'poi-towns',
        type: 'circle',
        source: 'pois',
        filter: ['==', ['get', 'kind'], 'town'],
        paint: {
          'circle-radius': 3.5,
          'circle-color': PIN_FILL,
          'circle-stroke-color': '#4A564F',
          'circle-stroke-width': 1.6,
        },
      });
      map.addLayer({
        id: 'poi-lodging',
        type: 'circle',
        source: 'pois',
        filter: ['==', ['get', 'kind'], 'accommodation'],
        paint: {
          'circle-radius': 4.5,
          'circle-color': '#6E4A7E',
          'circle-stroke-color': PIN_FILL,
          'circle-stroke-width': 1.6,
        },
      });
      map.addLayer({
        id: 'poi-food',
        type: 'symbol',
        source: 'pois',
        filter: ['==', ['get', 'kind'], 'food'],
        layout: { 'icon-image': 'food-diamond', 'icon-size': 1, 'icon-allow-overlap': true },
      });
      map.addLayer({
        id: 'poi-distillery',
        type: 'circle',
        source: 'pois',
        filter: ['==', ['get', 'kind'], 'distillery'],
        paint: {
          'circle-radius': 5.5,
          'circle-color': COPPER,
          'circle-stroke-color': PIN_FILL,
          'circle-stroke-width': 1.6,
        },
      });
      map.addLayer({
        id: 'poi-distillery-labels',
        type: 'symbol',
        source: 'pois',
        filter: ['==', ['get', 'kind'], 'distillery'],
        minzoom: 10,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': COPPER_TEXT, 'text-halo-color': PAPER, 'text-halo-width': 1.4 },
      });
      // stop names beside the numbered pins
      map.addLayer({
        id: 'stops-label',
        type: 'symbol',
        source: 'stops',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.35,
          'text-justify': 'auto',
        },
        paint: {
          'text-color': '#1F2A24',
          'text-halo-color': PAPER,
          'text-halo-width': 4,
        },
      });
      // ring around POIs hovered from a day card (e.g. lunch options)
      map.addLayer({
        id: 'poi-highlight',
        type: 'circle',
        source: 'poi-highlight',
        paint: {
          'circle-radius': 10,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': AMBER,
          'circle-stroke-width': 3,
        },
      });

      // click: POI -> popup; near-trail -> add stop
      map.on('click', (e: MapMouseEvent) => {
        // pin clicks reach the map too; handle them here so the popup's close-on-click skips this event
        const pin = (e.originalEvent.target as Element).closest<HTMLElement>('.stop-marker');
        if (pin) {
          if (pin.dataset.id) usePlanner.getState().openStop(pin.dataset.id);
          return;
        }
        const poiHits = map.queryRenderedFeatures(e.point, {
          layers: ['poi-towns', 'poi-lodging', 'poi-food', 'poi-distillery', 'poi-distillery-labels'],
        });
        if (poiHits.length) {
          const f = poiHits[0];
          const poi = POIS.find(p => p.id === f.properties.id);
          if (!poi) return;
          showPoiPopup(map, poi);
          return;
        }
        const { fracIdx, distM } = nearestOnTrail(e.lngLat.lat, e.lngLat.lng);
        if (distM < 150) usePlanner.getState().addStop(fracIdx);
      });
      map.on('mousemove', (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['poi-towns', 'poi-lodging', 'poi-food', 'poi-distillery', 'poi-distillery-labels', 'trail-hit'],
        });
        map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      });

      setReady(true);
    });

    return () => {
      markers.forEach(m => m.remove());
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // update segment lines + stop markers when itinerary/selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const nums = dayNumBySeg();
    const segs = deriveSegments(stops, skipped);
    const walked = {
      type: 'FeatureCollection' as const,
      features: segs
        .filter(s => !s.skipped)
        .map(s => ({
          type: 'Feature' as const,
          properties: {
            color: s.key === selected ? AMBER : dayColor(nums.get(s.key) ?? 1),
            sel: s.key === selected,
          },
          geometry: { type: 'LineString' as const, coordinates: trailSlice(s.from.trailIdx, s.to.trailIdx) },
        })),
    };
    const skippedFc = {
      type: 'FeatureCollection' as const,
      features: segs
        .filter(s => s.skipped)
        .map(s => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: trailSlice(s.from.trailIdx, s.to.trailIdx) },
        })),
    };
    (map.getSource('segments') as GeoJSONSource)?.setData(walked);
    (map.getSource('segments-skipped') as GeoJSONSource)?.setData(skippedFc);
    // routed spurs to off-trail lodging picks
    (map.getSource('detours') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: stops.flatMap(s => {
        const p = s.lodgingId ? POIS.find(x => x.id === s.lodgingId) : null;
        return p?.detour
          ? [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'LineString' as const, coordinates: p.detour.coords },
              },
            ]
          : [];
      }),
    });
    (map.getSource('poi-chosen') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: stops.flatMap(s => {
        const p = s.lodgingId ? POIS.find(x => x.id === s.lodgingId) : null;
        return p
          ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } }]
          : [];
      }),
    });
    (map.getSource('stops') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: stops.map(s => ({
        type: 'Feature' as const,
        properties: { name: s.name },
        geometry: {
          type: 'Point' as const,
          coordinates: (() => {
            const p = positionAt(s.trailIdx);
            return [p.lon, p.lat];
          })(),
        },
      })),
    });

    // pins bounding the selected day
    const selBounds = new Set(selected?.split('>') ?? []);

    // sync stop markers
    const markers = markersRef.current;
    const ids = new Set(stops.map(s => s.id));
    for (const [id, m] of markers) {
      if (!ids.has(id)) {
        m.remove();
        markers.delete(id);
      }
    }
    stops.forEach((stop, i) => {
      const pos = positionAt(stop.trailIdx);
      let m = markers.get(stop.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'stop-marker';
        m = new Marker({ element: el })
          .setLngLat([pos.lon, pos.lat])
          .addTo(map);
        el.dataset.id = stop.id;
        markers.set(stop.id, m);
      } else {
        m.setLngLat([pos.lon, pos.lat]);
      }
      const el = m.getElement();
      el.textContent = `${i + 1}`;
      el.classList.toggle('endpoint', i === 0 || i === stops.length - 1);
      el.classList.toggle('selbound', selBounds.has(stop.id));
      const lodge = stop.lodgingId ? POIS.find(p => p.id === stop.lodgingId)?.name : null;
      el.title = lodge ? `${stop.name} — ${lodge}` : stop.name;
    });
  }, [stops, skipped, restAt, selected, ready]);

  // an open popup's day/night actions are stale once the route changes
  const routeSig = stops.map(s => s.id).join('>');
  useEffect(() => {
    popupRef.current?.remove();
  }, [routeSig, skipped]);

  // update POI layer when toggles change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = {
      type: 'FeatureCollection' as const,
      features: POIS.filter(p => showPois[p.kind]).map(p => ({
        type: 'Feature' as const,
        properties: { id: p.id, name: p.name ?? '', kind: p.kind },
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      })),
    };
    (map.getSource('pois') as GeoJSONSource)?.setData(fc);
  }, [showPois, ready]);

  // ring-highlight POIs hovered from a day card
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('poi-highlight') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: (hoverPois ?? []).flatMap(id => {
        const p = POIS.find(x => x.id === id);
        return p
          ? [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
              },
            ]
          : [];
      }),
    });
  }, [hoverPois, ready]);

  // fly to a segment when a day is selected / "show on map" is pressed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusSeg) return;
    const seg = deriveSegments(
      usePlanner.getState().stops,
      usePlanner.getState().skipped,
    ).find(s => s.key === focusSeg.key);
    if (!seg) return;
    popupRef.current?.remove();
    const coords = trailSlice(seg.from.trailIdx, seg.to.trailIdx);
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    map.fitBounds(
      [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ] as LngLatBoundsLike,
      { padding: 80, duration: 900 },
    );
  }, [focusSeg, ready]);

  // zoom into a stop's town (pin click or lodging pill); hotels are picked from their own popups
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusStop) return;
    const stop = usePlanner.getState().stops.find(s => s.id === focusStop.id);
    if (!stop) return;
    const pos = positionAt(stop.trailIdx);
    map.easeTo({
      center: [pos.lon, pos.lat],
      zoom: Math.max(map.getZoom(), 13.5),
      duration: 800,
    });
    popupRef.current?.remove();
  }, [focusStop, ready]);

  const chip = (on: boolean) => `map-chip${on ? ' on' : ''}`;

  return (
    <div className="map-wrap">
      <div ref={ref} className="map" />

      <div className="map-chips" role="group" aria-label="Show on map">
        <span className="map-chips-label">Show</span>
        <button className={chip(showPois.town)} aria-pressed={showPois.town} onClick={() => togglePoi('town')}>
          <span className="swatch swatch-town" />
          Towns
        </button>
        <button
          className={chip(showPois.accommodation)}
          aria-pressed={showPois.accommodation}
          onClick={() => togglePoi('accommodation')}
        >
          <span className="swatch swatch-lodging" />
          Lodging
        </button>
        <button className={chip(showPois.food)} aria-pressed={showPois.food} onClick={() => togglePoi('food')}>
          <span className="swatch swatch-food" />
          Food
        </button>
        <button
          className={chip(showPois.distillery)}
          aria-pressed={showPois.distillery}
          onClick={() => togglePoi('distillery')}
        >
          <span className="swatch swatch-distillery" />
          Distilleries
        </button>
      </div>

      <div className="map-zoom" role="group" aria-label="Map controls">
        <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <div className="map-zoom-sep" />
        <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <div className="map-zoom-sep" />
        <button aria-label="Reset bearing to north" onClick={() => mapRef.current?.resetNorth()}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="12 2 19 21 12 17 5 21 12 2" fill="#C47F1E" stroke="#C47F1E" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <button
        className="map-fit"
        aria-label="Fit whole route"
        onClick={() => mapRef.current?.fitBounds(trailBounds(), { padding: 50, duration: 700 })}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
    </div>
  );
}
