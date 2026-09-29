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
  accommodationNear,
  fmtDistM,
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

const ICONS = {
  bed: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"></path><path d="M2 8h18a2 2 0 0 1 2 2v10"></path><path d="M2 17h20"></path><path d="M6 8v9"></path></svg>',
  close:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
};

export function TrailMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
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
    if (poi.kind === 'accommodation' || poi.kind === 'town') {
      const btn = document.createElement('button');
      btn.className = 'poi-add';
      btn.textContent = 'Add as overnight stop';
      btn.onclick = () => {
        usePlanner.getState().addStop(poi.trailIdx, poi);
        popup.remove();
      };
      el.appendChild(btn);
    }
    const popup = new Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat([poi.lon, poi.lat])
      .setDOMContent(el)
      .addTo(map);
  }

  function buildLodgeList(list: HTMLElement, stop: Stop, lodgeRow: HTMLElement) {
    list.innerHTML = '';
    const lodgings = accommodationNear(stop.trailIdx)
      .sort((a, b) => a.distToTrailM - b.distToTrailM)
      .slice(0, 14);
    // keep a chosen off-trail lodging visible even when it's beyond the list radius
    if (stop.lodgingId && !lodgings.some(p => p.id === stop.lodgingId)) {
      const sel = POIS.find(p => p.id === stop.lodgingId);
      if (sel) lodgings.unshift(sel);
    }

    const lodgeName = lodgeRow.querySelector('.lodge-name')!;
    const pick = (poiId: string | null, name: string, row: HTMLElement) => {
      usePlanner.getState().setLodging(stop.id, poiId);
      lodgeName.textContent = name;
      list.querySelectorAll('.lodge-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    };

    const clear = document.createElement('div');
    clear.className = `lodge-row ${!stop.lodgingId ? 'selected' : ''}`;
    clear.innerHTML = `<span class="lodge-thumb empty">–</span><span><em>No specific lodging</em></span>`;
    clear.onclick = () => pick(null, 'No lodging chosen for this night yet', clear);
    list.appendChild(clear);

    const imp = usePlanner.getState().imperial;
    for (const p of lodgings) {
      const row = document.createElement('div');
      row.className = `lodge-row ${p.id === stop.lodgingId ? 'selected' : ''}`;
      const thumb = p.imageUrl
        ? `<img class="lodge-thumb" src="${p.imageUrl}" loading="lazy" onerror="this.outerHTML='<span class=&quot;lodge-thumb empty&quot;>⌂</span>'" />`
        : `<span class="lodge-thumb empty">⌂</span>`;
      const dist = p.detour
        ? `${fmtDistM(p.detour.distM, imp)} walk each way`
        : `${fmtDistM(p.distToTrailM, imp)} off trail`;
      row.innerHTML = `${thumb}<span><div>${p.name ?? '(unnamed)'}</div><div class="muted">${p.subtype.replaceAll('_', ' ')} · ${dist}</div></span>`;
      const name = p.name ?? '(unnamed)';
      row.onclick = () => pick(p.id, name, row);
      list.appendChild(row);
    }
    if (!lodgings.length) {
      const note = document.createElement('div');
      note.className = 'muted lodge-empty';
      note.textContent = 'No lodging found within ~3km of this point.';
      list.appendChild(note);
    }
  }

  function openStopPopup(map: MLMap, stop: Stop) {
    const state = usePlanner.getState();
    const idx = state.stops.findIndex(s => s.id === stop.id);
    const interior = idx > 0 && idx < state.stops.length - 1;

    let n = 0;
    let endDay = 0;
    let startDay = 0;
    for (const d of deriveDays(state.stops, state.restAt, state.skipped)) {
      n++;
      if (d.type === 'rest') continue;
      if (d.seg.to.id === stop.id) endDay = n;
      if (d.seg.from.id === stop.id && !startDay) startDay = n;
    }
    const sub =
      endDay && startDay
        ? `End of day ${endDay} · start of day ${startDay}`
        : endDay
          ? `End of day ${endDay} · finish`
          : `Trailhead${startDay ? ` · start of day ${startDay}` : ''}`;

    const lodge = stop.lodgingId ? POIS.find(p => p.id === stop.lodgingId)?.name : null;

    const el = document.createElement('div');
    el.className = 'stop-popup';
    el.innerHTML = `
      <div class="sp-head">
        <div class="sp-title">
          <div class="sp-eyebrow">Stop ${idx + 1}</div>
          <div class="sp-name">${stop.name}</div>
          <div class="sp-sub">${sub}</div>
        </div>
        <button class="sp-close" aria-label="Close stop details">${ICONS.close}</button>
      </div>
      <div class="sp-lodge">${ICONS.bed}<span class="lodge-name">${lodge ?? 'No lodging chosen for this night yet'}</span></div>
      ${
        interior
          ? `<div class="sp-nights">Nights here
              <button class="n-btn" data-d="-1" aria-label="Fewer nights">−</button>
              <span class="n-count">${(state.restAt[stop.id] ?? 0) + 1}</span>
              <button class="n-btn" data-d="1" aria-label="More nights">+</button>
            </div>`
          : ''
      }
      <div class="sp-actions">
        <button class="sp-choose">Choose lodging</button>
        ${interior ? '<button class="sp-remove">Remove stop</button>' : ''}
      </div>
      <div class="lodge-list"></div>`;

    const popup = new Popup({ closeButton: false, maxWidth: '280px' });
    const pos = positionAt(stop.trailIdx);
    popup.setLngLat([pos.lon, pos.lat]).setDOMContent(el).addTo(map);

    el.querySelector('.sp-close')!.addEventListener('click', () => popup.remove());
    el.querySelectorAll<HTMLButtonElement>('.sp-nights .n-btn').forEach(b =>
      b.addEventListener('click', () => {
        const st = usePlanner.getState();
        const next = Math.max(0, (st.restAt[stop.id] ?? 0) + Number(b.dataset.d));
        st.setRestDays(stop.id, next);
        el.querySelector('.n-count')!.textContent = `${next + 1}`;
      }),
    );
    el.querySelector('.sp-remove')?.addEventListener('click', () => {
      usePlanner.getState().removeStop(stop.id);
      popup.remove();
    });
    const list = el.querySelector<HTMLElement>('.lodge-list')!;
    const lodgeRow = el.querySelector<HTMLElement>('.sp-lodge')!;
    el.querySelector('.sp-choose')!.addEventListener('click', () => {
      if (!list.dataset.built) {
        buildLodgeList(list, stop, lodgeRow);
        list.dataset.built = '1';
      }
      list.classList.toggle('open');
    });
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
          const cur = usePlanner.getState().stops.find(x => x.id === pin.dataset.id);
          if (cur) openStopPopup(map, cur);
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

  // fly to a stop + open its lodging picker (pin click or card click)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusStop) return;
    const stop = usePlanner.getState().stops.find(s => s.id === focusStop.id);
    if (!stop) return;
    if (focusStop.pan) {
      const pos = positionAt(stop.trailIdx);
      map.easeTo({
        center: [pos.lon, pos.lat],
        zoom: Math.max(map.getZoom(), 12.5),
        duration: 700,
      });
    }
    openStopPopup(map, stop);
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
