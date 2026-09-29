import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanner } from './store';
import { POIS, TRAIL, type Stop } from './lib/trail';

const S = () => usePlanner.getState();

const b64encode = (o: object) =>
  btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/** Fresh store module evaluated against the current location.hash/localStorage. */
const reloadStore = async () => {
  vi.resetModules();
  return (await import('./store')).usePlanner;
};

const stopTuple = (s: Stop) => [s.id, s.trailIdx, s.name, s.kind, s.lodgingId];

beforeEach(() => {
  S().reset();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('default state', () => {
  it('starts with the seven Speyside towns in trail order', () => {
    const stops = S().stops;
    expect(stops.map(s => s.name)).toEqual([
      'Buckie',
      'Fochabers',
      'Craigellachie',
      'Ballindalloch',
      'Grantown-on-Spey',
      'Aviemore',
      'Newtonmore',
    ]);
    expect(stops.map(s => s.trailIdx)).toEqual([...stops.map(s => s.trailIdx)].sort((a, b) => a - b));
  });
});

describe('addStop / moveStop / removeStop', () => {
  it('inserts a new stop sorted by trail position', () => {
    const idsBefore = new Set(S().stops.map(s => s.id));
    const a = S().stops[1];
    const b = S().stops[2];
    S().addStop((a.trailIdx + b.trailIdx) / 2);
    expect(S().stops).toHaveLength(8);
    expect(S().stops.filter(s => !idsBefore.has(s.id))).toHaveLength(1);
    const idxs = S().stops.map(s => s.trailIdx);
    expect(idxs).toEqual([...idxs].sort((x, y) => x - y));
  });

  it('dedupes stops by id', () => {
    const [a, b] = S().stops;
    const mid = Math.round((a.trailIdx + b.trailIdx) / 2);
    S().addStop(mid);
    const n = S().stops.length;
    S().addStop(mid);
    expect(S().stops).toHaveLength(n);
  });

  it('creates an accommodation stop with lodging pre-selected from a POI', () => {
    const poi = POIS.find(
      p =>
        p.kind === 'accommodation' &&
        !S().stops.some(s => s.id === `s${Math.round(p.trailIdx)}`),
    )!;
    S().addStop(poi.trailIdx, poi);
    const stop = S().stops.find(s => s.id === `s${Math.round(poi.trailIdx)}`)!;
    expect(stop.kind).toBe('accommodation');
    expect(stop.lodgingId).toBe(poi.id);
  });

  it('removes a stop but never drops below two', () => {
    const first = S().stops[0];
    S().removeStop(first.id);
    expect(S().stops).toHaveLength(6);
    expect(S().stops.some(s => s.id === first.id)).toBe(false);

    while (S().stops.length > 2) S().removeStop(S().stops[0].id);
    const [x, y] = S().stops.map(s => s.id);
    S().removeStop(x);
    expect(S().stops.map(s => s.id)).toEqual([x, y]);
  });

  it('cleans up keyed state (rest/skipped/extras/selected) for removed stops', () => {
    const [a, b, c] = S().stops;
    const keyAB = `${a.id}>${b.id}`;
    const keepKey = `${c.id}>${S().stops[3].id}`; // keyed to surviving stops
    S().setRestDays(b.id, 2);
    S().toggleSkip(keyAB);
    S().addExtra(keyAB, { text: 'lunch' });
    S().addExtra(`rest:${b.id}:1`, { text: 'nap' });
    S().addExtra(keepKey, { text: 'keep me' });
    usePlanner.setState({ selected: keyAB });

    S().removeStop(b.id);

    expect(S().restAt[b.id]).toBeUndefined();
    expect(S().skipped.has(keyAB)).toBe(false);
    expect(S().extras[keyAB]).toBeUndefined();
    expect(S().extras[`rest:${b.id}:1`]).toBeUndefined();
    expect(S().selected).toBeNull();
    expect(S().extras[keepKey]).toEqual([{ text: 'keep me' }]);
  });
});

describe('rest days, extras, skip', () => {
  it('sets and clears rest days', () => {
    const id = S().stops[1].id;
    S().setRestDays(id, 3);
    expect(S().restAt[id]).toBe(3);
    S().setRestDays(id, 0);
    expect(S().restAt[id]).toBeUndefined();
  });

  it('adds extras and removes them by index, deleting empty keys', () => {
    const key = 'a>b';
    S().addExtra(key, { text: 'one' });
    S().addExtra(key, { text: 'two' });
    S().removeExtra(key, 0);
    expect(S().extras[key]).toEqual([{ text: 'two' }]);
    S().removeExtra(key, 0);
    expect(S().extras[key]).toBeUndefined();
    expect('a>b' in S().extras).toBe(false);
  });

  it('toggles a segment skip on and off', () => {
    const key = 'a>b';
    S().toggleSkip(key);
    expect(S().skipped.has(key)).toBe(true);
    S().toggleSkip(key);
    expect(S().skipped.has(key)).toBe(false);
  });
});

describe('selection and focus', () => {
  it('selectDay sets selection and requests a map focus', () => {
    S().selectDay('a>b', 'b');
    expect(S().selected).toBe('a>b');
    expect(S().focusSeg).toEqual({ key: 'a>b', seq: 1 });
    expect(S().focusStop).toEqual({ id: 'b', seq: 1, pan: false });
    S().selectDay('b>c');
    expect(S().focusSeg?.seq).toBe(2);
  });

  it('openStop requests a popup with pan', () => {
    const prev = S().focusStop?.seq ?? 0;
    S().openStop('x');
    expect(S().focusStop).toEqual({ id: 'x', seq: prev + 1, pan: true });
  });
});

describe('lodging and units', () => {
  it('sets and clears a lodging pick', () => {
    const id = S().stops[1].id;
    S().setLodging(id, 'n123');
    expect(S().stops[1].lodgingId).toBe('n123');
    S().setLodging(id, null);
    expect(S().stops[1].lodgingId).toBeUndefined();
  });

  it('toggles and sets units', () => {
    const before = S().imperial;
    S().toggleUnits();
    expect(S().imperial).toBe(!before);
    S().setImperial(!before);
    expect(S().imperial).toBe(!before); // same value -> no-op
    S().setImperial(before);
    expect(S().imperial).toBe(before);
  });
});

describe('toggleDirection', () => {
  it('reverses stops and flips segment-keyed state', () => {
    const stops = S().stops;
    const key = `${stops[0].id}>${stops[1].id}`;
    const restKey = `rest:${stops[1].id}:1`;
    S().toggleSkip(key);
    S().addExtra(key, { text: 'pub' });
    S().addExtra(restKey, { text: 'nap' });
    usePlanner.setState({ selected: key });

    S().toggleDirection();

    const flipped = `${stops[1].id}>${stops[0].id}`;
    expect(S().reversed).toBe(true);
    expect(S().stops.map(s => s.id)).toEqual(stops.map(s => s.id).reverse());
    expect(S().skipped.has(flipped)).toBe(true);
    expect(S().skipped.has(key)).toBe(false);
    expect(S().extras[flipped]).toEqual([{ text: 'pub' }]);
    expect(S().extras[restKey]).toEqual([{ text: 'nap' }]);
    expect(S().selected).toBe(flipped);
  });
});

describe('persistence', () => {
  it('round-trips state through the URL hash', async () => {
    vi.useFakeTimers();
    const key = `${S().stops[0].id}>${S().stops[1].id}`;
    S().setRestDays(S().stops[1].id, 1);
    S().toggleSkip(key);
    S().addExtra(key, { text: 'pub lunch' });
    S().setImperial(true);
    S().setLodging(S().stops[2].id, 'n999');
    vi.advanceTimersByTime(300);
    expect(location.hash.startsWith('#i=')).toBe(true);

    const fresh = await reloadStore();
    const fs = fresh.getState();
    expect(fs.stops.map(stopTuple)).toEqual(S().stops.map(stopTuple));
    expect(fs.restAt).toEqual(S().restAt);
    expect([...fs.skipped]).toEqual([...S().skipped]);
    expect(fs.extras).toEqual(S().extras);
    expect(fs.imperial).toBe(true);
    expect(fs.reversed).toBe(false);
  });

  it('tolerates the v1 restAt array format', async () => {
    const blob = {
      s: [
        [10, 'A', 'town'],
        [500, 'B', 'town'],
        [900, 'C', 'town'],
      ],
      r: ['s500'],
      k: ['s10>s500'],
      e: {},
      d: 1,
      u: 0,
    };
    history.replaceState(null, '', `#i=${b64encode(blob)}`);
    const fresh = await reloadStore();
    const fs = fresh.getState();
    // d:1 (reversed) sorts stops in descending trail order
    expect(fs.stops.map(s => s.id)).toEqual(['s900', 's500', 's10']);
    expect(fs.restAt).toEqual({ s500: 1 });
    expect(fs.skipped.has('s10>s500')).toBe(true);
    expect(fs.reversed).toBe(true);
    expect(fs.imperial).toBe(false);
  });

  it('loads from localStorage when there is no hash', async () => {
    const blob = {
      s: [
        [20, 'X', 'town'],
        [400, 'Y', 'town'],
      ],
      r: {},
      k: [],
      e: {},
      d: 0,
      u: 1,
    };
    localStorage.setItem('speyside-itinerary-v1', JSON.stringify(blob));
    const fresh = await reloadStore();
    expect(fresh.getState().stops.map(s => s.name)).toEqual(['X', 'Y']);
    expect(fresh.getState().imperial).toBe(true);
  });

  it('falls back to defaults on a corrupt hash', async () => {
    history.replaceState(null, '', '#i=%%%not-base64%%%');
    const fresh = await reloadStore();
    expect(fresh.getState().stops).toHaveLength(7);
  });

  it('ignores a hash with fewer than two stops', async () => {
    const blob = { s: [[10, 'A', 'town']], r: {}, k: [], e: {}, d: 0, u: 0 };
    history.replaceState(null, '', `#i=${b64encode(blob)}`);
    const fresh = await reloadStore();
    expect(fresh.getState().stops).toHaveLength(7);
  });
});

describe('reset', () => {
  it('restores the default itinerary', () => {
    S().toggleDirection();
    S().setRestDays(S().stops[1].id, 5);
    S().reset();
    expect(S().stops).toHaveLength(7);
    expect(S().restAt).toEqual({});
    expect(S().skipped.size).toBe(0);
    expect(S().reversed).toBe(false);
    expect(S().selected).toBeNull();
  });
});

describe('trail data sanity used by store', () => {
  it('has enough points for stop ids used in tests', () => {
    expect(TRAIL.length).toBeGreaterThan(1000);
  });
});
