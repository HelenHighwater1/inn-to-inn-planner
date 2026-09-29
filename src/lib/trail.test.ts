import { describe, expect, it } from 'vitest';
import {
  accommodationNear,
  CANDIDATE_STOPS,
  distilleriesNear,
  distilleryPois,
  climbBetween,
  findCandidateByName,
  fmtDistM,
  fmtKm,
  fmtM,
  kmAt,
  lunchPois,
  nearestOnTrail,
  POIS,
  positionAt,
  snapCandidate,
  snapCandidatePreferTown,
  TRAIL,
  TRAIL_KM,
  trailSlice,
} from './trail';

describe('nearestOnTrail', () => {
  it('returns ~0 distance and the right index for a point on the trail', () => {
    const p = TRAIL[200];
    const { fracIdx, distM } = nearestOnTrail(p.lat, p.lon);
    expect(distM).toBeLessThan(5);
    expect(Math.abs(fracIdx - 200)).toBeLessThan(2);
  });

  it('interpolates a fractional index between adjacent points', () => {
    const a = TRAIL[100];
    const b = TRAIL[101];
    const { fracIdx, distM } = nearestOnTrail((a.lat + b.lat) / 2, (a.lon + b.lon) / 2);
    expect(distM).toBeLessThan(5);
    expect(fracIdx).toBeGreaterThan(100);
    expect(fracIdx).toBeLessThan(101);
  });

  it('reports a large distance for points far from the trail', () => {
    const { distM } = nearestOnTrail(56.0, -3.0); // ~Edinburgh
    expect(distM).toBeGreaterThan(50_000);
  });
});

describe('positionAt', () => {
  it('returns exact endpoints at integer indices', () => {
    expect(positionAt(0)).toEqual({ lat: TRAIL[0].lat, lon: TRAIL[0].lon });
    const last = TRAIL[TRAIL.length - 1];
    expect(positionAt(TRAIL.length - 1)).toEqual({ lat: last.lat, lon: last.lon });
  });

  it('interpolates the midpoint at fractional indices', () => {
    const pos = positionAt(50.5);
    expect(pos.lat).toBeCloseTo((TRAIL[50].lat + TRAIL[51].lat) / 2, 10);
    expect(pos.lon).toBeCloseTo((TRAIL[50].lon + TRAIL[51].lon) / 2, 10);
  });

  it('extrapolates linearly for indices beyond the ends', () => {
    // positionAt clamps the segment index but not the interpolation factor —
    // callers only ever pass in-range indices (e.g. from nearestOnTrail)
    const p = positionAt(TRAIL.length);
    expect(Number.isFinite(p.lat)).toBe(true);
    expect(Number.isFinite(p.lon)).toBe(true);
  });
});

describe('kmAt', () => {
  it('is 0 at the start and TRAIL_KM at the end', () => {
    expect(kmAt(0)).toBe(0);
    expect(kmAt(TRAIL.length - 1)).toBe(TRAIL_KM);
  });

  it('interpolates between points', () => {
    expect(kmAt(10.5)).toBeCloseTo((TRAIL[10].cumDistKm + TRAIL[11].cumDistKm) / 2, 10);
  });
});

describe('trailSlice', () => {
  it('starts and ends at the interpolated boundary positions', () => {
    const pts = trailSlice(10, 20);
    const a = positionAt(10);
    const b = positionAt(20);
    expect(pts[0]).toEqual([a.lon, a.lat]);
    expect(pts[pts.length - 1]).toEqual([b.lon, b.lat]);
    expect(pts).toContainEqual([TRAIL[15].lon, TRAIL[15].lat]);
  });

  it('produces the same slice regardless of argument order', () => {
    expect(trailSlice(20.25, 10.5)).toEqual(trailSlice(10.5, 20.25));
  });
});

describe('climbBetween', () => {
  it('reports positive ascent and descent', () => {
    const { gainM, lossM } = climbBetween(0, TRAIL.length - 1);
    expect(gainM).toBeGreaterThan(0);
    expect(lossM).toBeGreaterThan(0);
  });

  it('swaps gain and loss when the direction reverses', () => {
    const fwd = climbBetween(100, 200);
    const rev = climbBetween(200, 100);
    expect(rev.gainM).toBe(fwd.lossM);
    expect(rev.lossM).toBe(fwd.gainM);
  });

  it('equals the sum of positive elevation deltas over the whole trail', () => {
    let expected = 0;
    for (let i = 1; i < TRAIL.length; i++) {
      expected += Math.max(0, TRAIL[i].ele - TRAIL[i - 1].ele);
    }
    expect(climbBetween(0, TRAIL.length - 1).gainM).toBeCloseTo(expected, 10);
  });

  it('returns 0 gain over a descending stretch', () => {
    // find 6 consecutive points where elevation never rises (incl. the step into the range)
    const isDesc = (i: number) => {
      for (let j = i; j <= i + 5; j++) {
        if (TRAIL[j].ele > TRAIL[j - 1].ele) return false;
      }
      return true;
    };
    const start = TRAIL.findIndex((_, i) => i >= 1 && i <= TRAIL.length - 6 && isDesc(i));
    expect(start).toBeGreaterThan(0);
    expect(climbBetween(start, start + 5).gainM).toBe(0);
  });
});

describe('CANDIDATE_STOPS / snapping', () => {
  it('only contains named towns and accommodation near the trail', () => {
    for (const c of CANDIDATE_STOPS) {
      expect(c.name).toBeTruthy();
      expect(['town', 'accommodation']).toContain(c.kind);
      expect(c.distToTrailM).toBeLessThanOrEqual(2500);
    }
  });

  it('snaps to a nearby candidate along the trail', () => {
    const town = CANDIDATE_STOPS.find(c => c.kind === 'town')!;
    const hit = snapCandidate(town.trailIdx);
    expect(hit).not.toBeNull();
    expect(Math.abs(kmAt(hit!.trailIdx) - kmAt(town.trailIdx))).toBeLessThanOrEqual(4);
  });

  it('returns null when nothing is within maxKm', () => {
    expect(snapCandidate(100, 0)).toBeNull();
  });

  it('prefers towns over other candidates', () => {
    for (const c of CANDIDATE_STOPS.filter(x => x.kind === 'town')) {
      expect(snapCandidatePreferTown(c.trailIdx)?.kind).toBe('town');
    }
  });
});

describe('POI range queries', () => {
  it('lunchPois returns food POIs in the middle 50% of a segment', () => {
    const from = 500;
    const to = 1500;
    const span = to - from;
    const results = lunchPois(from, to);
    for (const p of results) {
      expect(p.kind).toBe('food');
      expect(p.distToTrailM).toBeLessThanOrEqual(805);
      expect(p.trailIdx).toBeGreaterThanOrEqual(from + span * 0.25);
      expect(p.trailIdx).toBeLessThanOrEqual(to - span * 0.25);
    }
    // order of endpoints doesn't matter
    expect(lunchPois(to, from).map(p => p.id).sort()).toEqual(results.map(p => p.id).sort());
  });

  it('accommodationNear returns lodging within 3km along-trail', () => {
    const results = accommodationNear(1000);
    const km = kmAt(1000);
    for (const p of results) {
      expect(p.kind).toBe('accommodation');
      expect(p.distToTrailM).toBeLessThanOrEqual(2000);
      expect(Math.abs(kmAt(p.trailIdx) - km)).toBeLessThan(3);
    }
  });

  it('distilleryPois spans the whole segment', () => {
    const results = distilleryPois(0, TRAIL.length - 1);
    expect(results.length).toBeGreaterThan(0);
    for (const p of results) {
      expect(p.kind).toBe('distillery');
      expect(p.distToTrailM).toBeLessThanOrEqual(5000);
    }
    expect(results.map(p => p.id).sort()).toEqual(
      POIS.filter(p => p.kind === 'distillery' && p.distToTrailM <= 5000)
        .map(p => p.id)
        .sort(),
    );
  });

  it('distilleriesNear bounds along-trail distance', () => {
    const results = distilleriesNear(1000);
    const km = kmAt(1000);
    for (const p of results) {
      expect(p.kind).toBe('distillery');
      expect(Math.abs(kmAt(p.trailIdx) - km)).toBeLessThanOrEqual(7);
    }
  });
});

describe('findCandidateByName', () => {
  it('finds exact and case-insensitive prefix matches', () => {
    expect(findCandidateByName('Aviemore')?.name).toBe('Aviemore');
    expect(findCandidateByName('aviem')).toBeDefined();
    expect(findCandidateByName('Nowhereland')).toBeUndefined();
  });
});

describe('formatting', () => {
  it('formats distances in metric and imperial', () => {
    expect(fmtKm(10, false)).toBe('10.0 km');
    expect(fmtKm(10, true)).toBe('6.2 mi');
    expect(fmtM(1500, false)).toBe('1500 m');
    expect(fmtM(1500, true)).toBe('4921 ft');
  });

  it('formats short distances with unit switching', () => {
    expect(fmtDistM(50, false)).toBe('50 m');
    expect(fmtDistM(1500, false)).toBe('1.5 km');
    expect(fmtDistM(50, true)).toBe('164 ft'); // <0.1mi shows feet
    expect(fmtDistM(500, true)).toBe('0.3 mi');
  });
});
