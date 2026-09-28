import trailData from '../data/trail.json';
import poiData from '../data/pois.json';

export interface TrailPoint {
  lat: number;
  lon: number;
  ele: number;
  cumDistKm: number;
}

export interface Poi {
  id: string;
  name: string | null;
  kind: 'accommodation' | 'food' | 'town' | 'distillery';
  subtype: string;
  lat: number;
  lon: number;
  trailIdx: number; // fractional index into TRAIL
  distToTrailM: number;
  phone?: string;
  website?: string;
  imageUrl?: string;
  popular?: boolean; // distilleries: visitor tagging / web presence proxy
  detour?: { distM: number; coords: [number, number][] }; // foot-routed spur from the best trail junction
}

export interface Stop {
  id: string;
  trailIdx: number;
  name: string;
  kind: 'town' | 'accommodation' | 'custom';
  lodgingId?: string; // chosen accommodation POI for this overnight
  warn?: 'no-accommodation';
}

export const TRAIL = trailData as TrailPoint[];
export const POIS = poiData as Poi[];
export const TRAIL_KM = TRAIL[TRAIL.length - 1].cumDistKm;

const K = 111320;
const D2R = Math.PI / 180;
const xy = (lat: number, lon: number, lat0: number): [number, number] => [
  lon * K * Math.cos(lat0 * D2R),
  lat * K,
];

/** Project a lat/lon onto the trail polyline. Returns fractional trail index + distance. */
export function nearestOnTrail(lat: number, lon: number): { fracIdx: number; distM: number } {
  let best = { fracIdx: 0, distM: Infinity };
  const [px, py] = xy(lat, lon, lat);
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i];
    const b = TRAIL[i + 1];
    const [ax, ay] = xy(a.lat, a.lon, a.lat);
    const [bx, by] = xy(b.lat, b.lon, a.lat);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (d < best.distM) best = { distM: d, fracIdx: i + t };
  }
  return best;
}

/** Interpolated lat/lon at a fractional trail index. */
export function positionAt(fracIdx: number): { lat: number; lon: number } {
  const i = Math.max(0, Math.min(TRAIL.length - 2, Math.floor(fracIdx)));
  const t = fracIdx - i;
  const a = TRAIL[i];
  const b = TRAIL[i + 1];
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Cumulative trail distance (km) at a fractional index. */
export function kmAt(fracIdx: number): number {
  const i = Math.max(0, Math.min(TRAIL.length - 2, Math.floor(fracIdx)));
  const t = fracIdx - i;
  return TRAIL[i].cumDistKm + (TRAIL[i + 1].cumDistKm - TRAIL[i].cumDistKm) * t;
}

/** Polyline coordinates for the trail slice [fromIdx, toIdx] as [lon,lat][]. */
export function trailSlice(fromIdx: number, toIdx: number): [number, number][] {
  const a = Math.min(fromIdx, toIdx);
  const b = Math.max(fromIdx, toIdx);
  const pts: [number, number][] = [];
  const pa = positionAt(a);
  const pb = positionAt(b);
  pts.push([pa.lon, pa.lat]);
  for (let i = Math.ceil(a); i <= Math.floor(b); i++) pts.push([TRAIL[i].lon, TRAIL[i].lat]);
  pts.push([pb.lon, pb.lat]);
  return pts;
}

/** Sum of positive elevation deltas between fractional indices (elevation already smoothed). */
export function gainBetween(fromIdx: number, toIdx: number): number {
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  let gain = 0;
  for (let i = Math.max(1, Math.ceil(lo)); i <= Math.floor(hi); i++) {
    gain += Math.max(0, TRAIL[i].ele - TRAIL[i - 1].ele);
  }
  return gain;
}

/** Named towns + accommodation near the trail — the snap targets for stop pins. */
export const CANDIDATE_STOPS = POIS.filter(
  p => p.name && (p.kind === 'town' || p.kind === 'accommodation') && p.distToTrailM <= 2500,
);

/** Nearest candidate stop to a trail position, within maxKm along-trail. */
export function snapCandidate(fracIdx: number, maxKm = 4): Poi | null {
  const km = kmAt(fracIdx);
  let best: Poi | null = null;
  let bestD = maxKm;
  for (const c of CANDIDATE_STOPS) {
    const d = Math.abs(kmAt(c.trailIdx) - km);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Like snapCandidate but prefers towns — a stop is "where you sleep", the hotel is chosen separately. */
export function snapCandidatePreferTown(fracIdx: number, maxKm = 4): Poi | null {
  const km = kmAt(fracIdx);
  let bestTown: Poi | null = null;
  let bestTownD = maxKm;
  let bestAny: Poi | null = null;
  let bestAnyD = maxKm;
  for (const c of CANDIDATE_STOPS) {
    const d = Math.abs(kmAt(c.trailIdx) - km);
    if (d < bestAnyD) {
      bestAnyD = d;
      bestAny = c;
    }
    if (c.kind === 'town' && d < bestTownD) {
      bestTownD = d;
      bestTown = c;
    }
  }
  return bestTown ?? bestAny;
}

/** Food POIs within maxM of the trail, in the middle 50% of a segment. */
export function lunchPois(fromIdx: number, toIdx: number, maxM = 805): Poi[] {
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const span = hi - lo;
  const a = lo + span * 0.25;
  const b = hi - span * 0.25;
  return POIS.filter(p => p.kind === 'food' && p.distToTrailM <= maxM && p.trailIdx >= a && p.trailIdx <= b);
}

/** Accommodation POIs within maxM of the trail and within 3km along-trail of a position. */
export function accommodationNear(fracIdx: number, maxM = 2000): Poi[] {
  const km = kmAt(fracIdx);
  return POIS.filter(
    p =>
      p.kind === 'accommodation' &&
      p.distToTrailM <= maxM &&
      Math.abs(kmAt(p.trailIdx) - km) < 3,
  );
}

/** Distilleries across a segment's whole span (incl. near the endpoint towns). */
export function distilleryPois(fromIdx: number, toIdx: number, maxM = 5000): Poi[] {
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return POIS.filter(
    p => p.kind === 'distillery' && p.distToTrailM <= maxM && p.trailIdx >= lo && p.trailIdx <= hi,
  );
}

/** Distilleries near a single trail position — for rest-day side trips. */
export function distilleriesNear(fracIdx: number, maxM = 5000, alongKm = 7): Poi[] {
  const km = kmAt(fracIdx);
  return POIS.filter(
    p =>
      p.kind === 'distillery' &&
      p.distToTrailM <= maxM &&
      Math.abs(kmAt(p.trailIdx) - km) <= alongKm,
  );
}

export function findCandidateByName(name: string): Poi | undefined {
  const exact = CANDIDATE_STOPS.find(p => p.name === name);
  return exact ?? CANDIDATE_STOPS.find(p => p.name?.toLowerCase().startsWith(name.toLowerCase()));
}

export const fmtKm = (km: number, imperial: boolean) =>
  imperial ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`;
export const fmtM = (m: number, imperial: boolean) =>
  imperial ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`;

/** Short distances (e.g. "off-trail"): feet under 0.1mi, else miles / metres, else km. */
export const fmtDistM = (m: number, imperial: boolean) => {
  if (imperial) {
    const mi = m / 1609.34;
    return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
};
