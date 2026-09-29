import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GeoJSONSource, Map as MLMap, type LngLatBoundsLike } from 'maplibre-gl';
import { deriveDays, deriveSegments } from '../lib/itinerary';
import { POIS, positionAt, trailSlice } from '../lib/trail';
import { dayColor, HEATHER, INK, PAPER, PIN_FILL, SKIPPED } from '../lib/colors';
import { MAP_STYLE } from '../lib/mapStyle';
import { usePlanner } from '../store';

const empty = { type: 'FeatureCollection' as const, features: [] };

/**
 * Whole-route overview for the printed itinerary. Renders an offscreen,
 * non-interactive map and snapshots it to an <img>, since WebGL canvases
 * don't print reliably.
 */
export function PrintMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const stops = usePlanner(s => s.stops);
  const restAt = usePlanner(s => s.restAt);
  const skipped = usePlanner(s => s.skipped);

  useEffect(() => {
    if (!ref.current) return;
    const map = new MLMap({
      container: ref.current,
      style: MAP_STYLE,
      center: [-3.4, 57.4],
      zoom: 8,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: 2,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('segments', { type: 'geojson', data: empty });
      map.addSource('segments-skipped', { type: 'geojson', data: empty });
      map.addSource('detours', { type: 'geojson', data: empty });
      map.addSource('stops', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'segments-casing',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PIN_FILL, 'line-width': 8 },
      });
      map.addLayer({
        id: 'segments-line',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
      });
      map.addLayer({
        id: 'segments-skipped-line',
        type: 'line',
        source: 'segments-skipped',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': SKIPPED, 'line-width': 3, 'line-dasharray': [3, 2.5] },
      });
      map.addLayer({
        id: 'detours-line',
        type: 'line',
        source: 'detours',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': HEATHER, 'line-width': 2.5, 'line-dasharray': [1, 2] },
      });
      map.addLayer({
        id: 'stops-dot',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': 10,
          'circle-color': ['case', ['get', 'end'], INK, PIN_FILL],
          'circle-stroke-color': INK,
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'stops-num',
        type: 'symbol',
        source: 'stops',
        layout: {
          'text-field': ['to-string', ['get', 'n']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': ['case', ['get', 'end'], PIN_FILL, INK] },
      });
      map.addLayer({
        id: 'stops-label',
        type: 'symbol',
        source: 'stops',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.3,
          'text-justify': 'auto',
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 3 },
      });
      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const nums = new Map<string, number>();
    deriveDays(stops, restAt, skipped).forEach((d, i) => {
      if (d.type !== 'rest') nums.set(d.seg.key, i + 1);
    });
    const segs = deriveSegments(stops, skipped);
    const line = (coordinates: [number, number][], properties = {}) => ({
      type: 'Feature' as const,
      properties,
      geometry: { type: 'LineString' as const, coordinates },
    });
    const segLines = segs.map(s => ({ s, coords: trailSlice(s.from.trailIdx, s.to.trailIdx) }));
    const detours = stops.flatMap(s => {
      const p = s.lodgingId ? POIS.find(x => x.id === s.lodgingId) : null;
      return p?.detour ? [p.detour.coords] : [];
    });

    (map.getSource('segments') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: segLines
        .filter(({ s }) => !s.skipped)
        .map(({ s, coords }) => line(coords, { color: dayColor(nums.get(s.key) ?? 1) })),
    });
    (map.getSource('segments-skipped') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: segLines.filter(({ s }) => s.skipped).map(({ coords }) => line(coords)),
    });
    (map.getSource('detours') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: detours.map(c => line(c)),
    });
    (map.getSource('stops') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: stops.map((s, i) => {
        const p = positionAt(s.trailIdx);
        return {
          type: 'Feature' as const,
          properties: { n: i + 1, name: s.name, end: i === 0 || i === stops.length - 1 },
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        };
      }),
    });

    const all = [...segLines.flatMap(x => x.coords), ...detours.flat()];
    if (all.length) {
      const lons = all.map(c => c[0]);
      const lats = all.map(c => c[1]);
      const bounds: LngLatBoundsLike = [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ];
      map.fitBounds(bounds, { padding: 56, animate: false });
    }

    const capture = () => {
      const c = map.getCanvas();
      if (c.width && c.height) setImg(c.toDataURL('image/png'));
    };
    map.once('idle', capture);
    return () => {
      map.off('idle', capture);
    };
  }, [stops, restAt, skipped, ready]);

  return (
    <>
      {createPortal(<div ref={ref} className="print-map-render" aria-hidden="true" />, document.body)}
      {img && (
        <figure className="ps-map">
          <img src={img} alt="Route overview map" />
          <figcaption>© OpenStreetMap contributors · OpenFreeMap</figcaption>
        </figure>
      )}
    </>
  );
}
