import { describe, expect, it } from 'vitest';
import { findCandidateByName, setActiveTrek, type Poi, type TrailPoint } from '../lib/trail';
import { TREK_LIST, type TrekId } from '../lib/treks';

// Sanity checks on the pre-generated data shipped with the app — catches a bad
// re-run of scripts/fetch-*.mjs before it reaches the UI.

const BOUNDS: Record<TrekId, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  speyside: { latMin: 56.5, latMax: 58.0, lonMin: -4.5, lonMax: -2.5 },
  'great-glen-way': { latMin: 56.7, latMax: 57.6, lonMin: -5.3, lonMax: -4.1 },
};

for (const trek of TREK_LIST) {
  const trailData = trek.trail as TrailPoint[];
  const poiData = trek.pois as Poi[];
  const b = BOUNDS[trek.id];

  describe(`${trek.id}/trail.json`, () => {
    it('is a dense polyline covering a plausible length', () => {
      expect(trailData.length).toBeGreaterThan(1000);
      expect(trailData[0].cumDistKm).toBe(0);
      const total = trailData[trailData.length - 1].cumDistKm;
      expect(total).toBeGreaterThan(100);
      expect(total).toBeLessThan(200);
    });

    it('has monotonically non-decreasing cumulative distance', () => {
      for (let i = 1; i < trailData.length; i++) {
        expect(trailData[i].cumDistKm).toBeGreaterThanOrEqual(trailData[i - 1].cumDistKm);
      }
    });

    it('starts and ends near the trailheads', () => {
      const first = trailData[0];
      const last = trailData[trailData.length - 1];
      expect(first.lat).toBeGreaterThan(b.latMin);
      expect(first.lat).toBeLessThan(b.latMax);
      expect(last.lat).toBeGreaterThan(b.latMin);
      expect(last.lat).toBeLessThan(b.latMax);
    });

    it('stays within the trek bounds with sane elevations', () => {
      for (const p of trailData) {
        expect(p.lat).toBeGreaterThan(b.latMin);
        expect(p.lat).toBeLessThan(b.latMax);
        expect(p.lon).toBeGreaterThan(b.lonMin);
        expect(p.lon).toBeLessThan(b.lonMax);
        expect(p.ele).toBeGreaterThan(-10);
        expect(p.ele).toBeLessThan(1500);
      }
    });
  });

  describe(`${trek.id}/pois.json`, () => {
    const kinds = new Set(['accommodation', 'food', 'town', 'distillery']);

    it('has unique ids and valid kinds', () => {
      const ids = new Set(poiData.map(p => p.id));
      expect(ids.size).toBe(poiData.length);
      for (const p of poiData) {
        expect(kinds.has(p.kind)).toBe(true);
      }
    });

    it('references in-bounds trail positions and non-negative distances', () => {
      for (const p of poiData) {
        expect(p.trailIdx).toBeGreaterThanOrEqual(0);
        expect(p.trailIdx).toBeLessThanOrEqual(trailData.length - 1);
        expect(p.distToTrailM).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(p.lat)).toBe(true);
        expect(Number.isFinite(p.lon)).toBe(true);
      }
    });

    it('has well-formed detour geometry when present', () => {
      for (const p of poiData) {
        if (!p.detour) continue;
        expect(p.detour.distM).toBeGreaterThan(0);
        for (const c of p.detour.coords) {
          expect(c).toHaveLength(2);
          expect(Number.isFinite(c[0])).toBe(true);
          expect(Number.isFinite(c[1])).toBe(true);
          // GeoJSON order is [lon, lat] — Highland bounds catch a swapped pair
          expect(c[0]).toBeGreaterThan(-6);
          expect(c[0]).toBeLessThan(-2);
          expect(c[1]).toBeGreaterThan(56);
          expect(c[1]).toBeLessThan(59);
        }
      }
    });
  });

  describe(`${trek.id} default itinerary towns`, () => {
    it('resolves every default stop name to a candidate', () => {
      setActiveTrek(trek.id);
      for (const name of trek.defaultStops) {
        expect(findCandidateByName(name), name).toBeDefined();
      }
    });
  });
}
