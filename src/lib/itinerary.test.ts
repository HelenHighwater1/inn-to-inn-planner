import { describe, expect, it } from 'vitest';
import { deriveDays, deriveSegments, segKey } from './itinerary';
import { kmAt, type Stop } from './trail';

const mk = (id: string, trailIdx: number): Stop => ({
  id,
  trailIdx,
  name: `Stop ${id}`,
  kind: 'custom',
});

const stops = [mk('a', 10), mk('b', 500), mk('c', 1000)];

describe('deriveSegments', () => {
  it('produces one segment per adjacent pair, in order', () => {
    const segs = deriveSegments(stops, new Set());
    expect(segs).toHaveLength(2);
    expect(segs.map(s => s.key)).toEqual(['a>b', 'b>c']);
    expect(segs[0].from.id).toBe('a');
    expect(segs[0].to.id).toBe('b');
  });

  it('computes walking distance from trail positions', () => {
    const [seg] = deriveSegments(stops, new Set());
    expect(seg.distKm).toBeCloseTo(kmAt(500) - kmAt(10), 10);
    // a straight line is never longer than the trail between the same points
    expect(seg.cabKm).toBeGreaterThan(0);
    expect(seg.cabKm).toBeLessThanOrEqual(seg.distKm * 1.001);
    expect(seg.gainM).toBeGreaterThanOrEqual(0);
    expect(seg.lossM).toBeGreaterThanOrEqual(0);
  });

  it('reports ascent/descent in the walking direction', () => {
    const fwd = deriveSegments(stops, new Set());
    const rev = deriveSegments([...stops].reverse(), new Set());
    // rev segments run c>b, b>a — rev[1] traverses a>b backwards
    expect(rev[1].key).toBe('b>a');
    expect(rev[1].gainM).toBeCloseTo(fwd[0].lossM, 10);
    expect(rev[1].lossM).toBeCloseTo(fwd[0].gainM, 10);
  });

  it('marks skipped segments', () => {
    const segs = deriveSegments(stops, new Set(['b>c']));
    expect(segs[0].skipped).toBe(false);
    expect(segs[1].skipped).toBe(true);
  });
});

describe('deriveDays', () => {
  it('emits one walk day per segment', () => {
    const days = deriveDays(stops, {}, new Set());
    expect(days).toHaveLength(2);
    expect(days.every(d => d.type === 'walk')).toBe(true);
  });

  it('inserts rest days after the segment ending at that stop', () => {
    const days = deriveDays(stops, { b: 2 }, new Set());
    expect(days.map(d => d.type)).toEqual(['walk', 'rest', 'rest', 'walk']);
    expect(days[1]).toMatchObject({ stop: { id: 'b' }, num: 1, of: 2 });
    expect(days[2]).toMatchObject({ stop: { id: 'b' }, num: 2, of: 2 });
  });

  it('ignores rest days at the final stop', () => {
    const days = deriveDays(stops, { c: 3 }, new Set());
    expect(days.filter(d => d.type === 'rest')).toHaveLength(0);
  });

  it('renders skipped segments as cab days', () => {
    const days = deriveDays(stops, {}, new Set([segKey(stops[0], stops[1])]));
    expect(days[0].type).toBe('cab');
    expect(days[1].type).toBe('walk');
  });
});
