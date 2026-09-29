import { describe, expect, it } from 'vitest';
import trailData from './trail.json';
import poiDataJson from './pois.json';
import { findCandidateByName, type Poi } from '../lib/trail';

const poiData = poiDataJson as Poi[];

// Sanity checks on the pre-generated data shipped with the app — catches a bad
// re-run of scripts/fetch-*.mjs before it reaches the UI.

const DEFAULT_TOWNS = [
  'Buckie',
  'Fochabers',
  'Craigellachie',
  'Ballindalloch',
  'Grantown-on-Spey',
  'Aviemore',
  'Newtonmore',
];

describe('trail.json', () => {
  it('is a dense polyline covering a plausible Speyside Way length', () => {
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

  it('stays within northeast Scotland with sane elevations', () => {
    for (const p of trailData) {
      expect(p.lat).toBeGreaterThan(56.5);
      expect(p.lat).toBeLessThan(58.0);
      expect(p.lon).toBeGreaterThan(-4.5);
      expect(p.lon).toBeLessThan(-2.5);
      expect(p.ele).toBeGreaterThan(-10);
      expect(p.ele).toBeLessThan(1500);
    }
  });
});

describe('pois.json', () => {
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
      }
    }
  });
});

describe('default itinerary towns', () => {
  it('resolves every default stop name to a candidate', () => {
    for (const name of DEFAULT_TOWNS) {
      expect(findCandidateByName(name), name).toBeDefined();
    }
  });
});
