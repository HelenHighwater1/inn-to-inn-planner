import { gainBetween, kmAt, positionAt, type Stop } from './trail';

export interface Segment {
  key: string; // "idA>idB"
  from: Stop;
  to: Stop;
  skipped: boolean;
  distKm: number;
  gainM: number;
  cabKm: number; // straight-line distance (approx cab distance when skipped)
}

export type DayRow =
  | { type: 'walk' | 'cab'; seg: Segment }
  | { type: 'rest'; stop: Stop; num: number; of: number };

export const segKey = (a: Stop, b: Stop) => `${a.id}>${b.id}`;

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export function deriveSegments(stops: Stop[], skipped: Set<string>): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const key = segKey(from, to);
    segs.push({
      key,
      from,
      to,
      skipped: skipped.has(key),
      distKm: Math.abs(kmAt(to.trailIdx) - kmAt(from.trailIdx)),
      gainM: gainBetween(from.trailIdx, to.trailIdx),
      cabKm: haversineKm(positionAt(from.trailIdx), positionAt(to.trailIdx)),
    });
  }
  return segs;
}

export function deriveDays(stops: Stop[], restAt: Record<string, number>, skipped: Set<string>): DayRow[] {
  const days: DayRow[] = [];
  const segs = deriveSegments(stops, skipped);
  segs.forEach((seg, i) => {
    days.push({ type: seg.skipped ? 'cab' : 'walk', seg });
    const n = i < segs.length - 1 ? (restAt[seg.to.id] ?? 0) : 0;
    for (let k = 1; k <= n; k++) days.push({ type: 'rest', stop: seg.to, num: k, of: n });
  });
  return days;
}
