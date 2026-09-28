import { create } from 'zustand';
import {
  findCandidateByName,
  kmAt,
  snapCandidatePreferTown,
  TRAIL,
  type Poi,
  type Stop,
} from './lib/trail';

/** A visit/note added to a specific day — a POI reference or free text. */
export interface Extra {
  poiId?: string;
  text?: string;
}

interface PlannerState {
  stops: Stop[]; // in walking order (trailIdx, descending when reversed); first/last are the trip endpoints
  restAt: Record<string, number>; // stop id -> rest days (extra nights) on arrival
  skipped: Set<string>; // segment keys done by cab
  extras: Record<string, Extra[]>; // day key ("idA>idB" or "rest:{id}") -> visits/notes
  reversed: boolean; // hiking direction: false = Buckie → Newtonmore
  imperial: boolean;
  selected: string | null; // selected day: segment key "idA>idB" or "rest:{stopId}"
  focusSeg: { key: string; seq: number } | null; // table -> map fly-to request
  focusStop: { id: string; seq: number; pan: boolean } | null; // open stop popup; pan = also fly to the stop
  showPois: { accommodation: boolean; food: boolean; town: boolean; distillery: boolean };
  hoverPois: string[] | null; // poi ids to highlight on the map (e.g. lunch hover)
  selectDay: (key: string, endStopId?: string) => void;
  focusSegment: (key: string) => void;
  openStop: (id: string) => void;
  setLodging: (stopId: string, poiId: string | null) => void;
  addStop: (fracIdx: number, poi?: Poi) => void;
  moveStop: (id: string, fracIdx: number) => void;
  removeStop: (id: string) => void;
  setRestDays: (stopId: string, days: number) => void;
  addExtra: (key: string, extra: Extra) => void;
  removeExtra: (key: string, idx: number) => void;
  toggleSkip: (key: string) => void;
  toggleDirection: () => void;
  togglePoi: (kind: 'accommodation' | 'food' | 'town' | 'distillery') => void;
  toggleUnits: () => void;
  setImperial: (v: boolean) => void;
  setHoverPois: (ids: string[] | null) => void;
  reset: () => void;
}

const stopId = (trailIdx: number) => `s${Math.round(trailIdx)}`;

/** Stop for a clicked POI (e.g. "Add as overnight stop" on a hotel). */
function makeStopFromPoi(poi: Poi): Stop {
  return {
    id: stopId(poi.trailIdx),
    trailIdx: poi.trailIdx,
    name: poi.name ?? 'Stop',
    kind: poi.kind === 'town' ? 'town' : 'accommodation',
    lodgingId: poi.kind === 'accommodation' ? poi.id : undefined,
  };
}

/** Snap a dropped pin to the nearest town/accommodation; fall back to a custom trail point. */
function makeStop(fracIdx: number, imperial = false): Stop {
  const c = snapCandidatePreferTown(fracIdx);
  if (c) return makeStopFromPoi(c);
  const km = kmAt(fracIdx);
  return {
    id: stopId(fracIdx),
    trailIdx: fracIdx,
    name: imperial ? `Trail mi ${(km * 0.621371).toFixed(1)}` : `Trail km ${km.toFixed(1)}`,
    kind: 'custom',
    warn: 'no-accommodation',
  };
}

function defaultStops(): Stop[] {
  const names = ['Buckie', 'Fochabers', 'Craigellachie', 'Ballindalloch', 'Grantown-on-Spey', 'Aviemore', 'Newtonmore'];
  const stops = names
    .map(n => findCandidateByName(n))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map(c => ({
      id: stopId(c.trailIdx),
      trailIdx: c.trailIdx,
      name: c.name!,
      kind: 'town' as const,
    }));
  if (stops.length < 2) return [makeStop(0), makeStop(TRAIL.length - 1)];
  return stops;
}

// ---- URL hash + localStorage persistence ----

interface Persisted {
  s: [number, string, string, string?][];
  r: Record<string, number> | string[]; // v2: id -> rest days; v1 tolerated (array of ids)
  k: string[];
  e: Record<string, Extra[]>;
  d: 0 | 1;
  u: 0 | 1;
}
const LS_KEY = 'speyside-itinerary-v1';

const trailOrder = (reversed: boolean) => (a: Stop, b: Stop) =>
  reversed ? b.trailIdx - a.trailIdx : a.trailIdx - b.trailIdx;

function serialize(s: PlannerState): Persisted {
  return {
    s: s.stops.map(st => [+st.trailIdx.toFixed(1), st.name, st.kind, st.lodgingId]),
    r: s.restAt,
    k: [...s.skipped],
    e: s.extras,
    d: s.reversed ? 1 : 0,
    u: s.imperial ? 1 : 0,
  };
}

function b64encode(o: object): string {
  return btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function b64decode(s: string): object {
  return JSON.parse(atob(s.replaceAll('-', '+').replaceAll('_', '/')));
}

function loadInitial(): Pick<
  PlannerState,
  'stops' | 'restAt' | 'skipped' | 'extras' | 'reversed' | 'imperial'
> {
  let blob: Persisted | null = null;
  try {
    const h = location.hash;
    if (h.startsWith('#i=')) blob = b64decode(h.slice(3)) as Persisted;
    else {
      const ls = localStorage.getItem(LS_KEY);
      if (ls) blob = JSON.parse(ls) as Persisted;
    }
  } catch {
    blob = null;
  }
  if (blob && Array.isArray(blob.s) && blob.s.length >= 2) {
    const stops: Stop[] = blob.s
      .map(([trailIdx, name, kind, lodgingId]) => ({
        id: stopId(trailIdx),
        trailIdx,
        name,
        kind: kind as Stop['kind'],
        lodgingId: lodgingId || undefined,
      }))
      .sort(trailOrder(blob.d === 1));
    const restAt: Record<string, number> = Array.isArray(blob.r)
      ? Object.fromEntries(blob.r.map(id => [id, 1]))
      : (blob.r ?? {});
    return {
      stops,
      restAt,
      skipped: new Set(blob.k ?? []),
      extras: blob.e ?? {},
      reversed: blob.d === 1,
      imperial: blob.u === 1,
    };
  }
  return {
    stops: defaultStops(),
    restAt: {},
    skipped: new Set(),
    extras: {},
    reversed: false,
    imperial: false,
  };
}

const initial = loadInitial();

export const usePlanner = create<PlannerState>((set, get) => ({
  ...initial,
  selected: null,
  focusSeg: null,
  focusStop: null,
  showPois: { accommodation: true, food: false, town: true, distillery: true },
  hoverPois: null,

  // selecting a day card: highlight on the map, fly to the segment,
  // and open the popup on the day's end stop (without a second camera move)
  selectDay: (key, endStopId) =>
    set(s => ({
      selected: key,
      focusSeg: { key, seq: (s.focusSeg?.seq ?? 0) + 1 },
      ...(endStopId
        ? { focusStop: { id: endStopId, seq: (s.focusStop?.seq ?? 0) + 1, pan: false } }
        : {}),
    })),

  focusSegment: key => set(s => ({ focusSeg: { key, seq: (s.focusSeg?.seq ?? 0) + 1 } })),
  openStop: id => set(s => ({ focusStop: { id, seq: (s.focusStop?.seq ?? 0) + 1, pan: true } })),

  setLodging: (stopId, poiId) =>
    set(s => ({
      stops: s.stops.map(st =>
        st.id === stopId ? { ...st, lodgingId: poiId ?? undefined } : st,
      ),
    })),

  addStop: (fracIdx, poi) => {
    const stop = poi ? makeStopFromPoi(poi) : makeStop(fracIdx, get().imperial);
    set(s => {
      if (s.stops.some(x => x.id === stop.id)) return s;
      return { stops: [...s.stops, stop].sort(trailOrder(s.reversed)) };
    });
  },

  moveStop: (id, fracIdx) => {
    const snapped = makeStop(fracIdx, get().imperial);
    set(s => {
      const others = s.stops.filter(x => x.id !== id);
      // keep identity id so the dragged marker stays associated
      const moved: Stop = { ...snapped, id };
      return { stops: [...others, moved].sort(trailOrder(s.reversed)) };
    });
  },

  removeStop: id => {
    set(s => {
      const stops = s.stops.filter(x => x.id !== id);
      if (stops.length < 2) return s;
      const ids = new Set(stops.map(x => x.id));
      const keyAlive = (key: string) =>
        key.startsWith('rest:')
          ? ids.has(key.slice(5).split(':')[0])
          : key.split('>').every(x => ids.has(x));
      return {
        stops,
        selected: s.selected !== null && !keyAlive(s.selected) ? null : s.selected,
        restAt: Object.fromEntries(Object.entries(s.restAt).filter(([k]) => ids.has(k))),
        skipped: new Set([...s.skipped].filter(keyAlive)),
        extras: Object.fromEntries(Object.entries(s.extras).filter(([k]) => keyAlive(k))),
      };
    });
  },

  setRestDays: (stopId, days) =>
    set(s => {
      const restAt = { ...s.restAt };
      if (days <= 0) delete restAt[stopId];
      else restAt[stopId] = days;
      return { restAt };
    }),

  addExtra: (key, extra) =>
    set(s => ({ extras: { ...s.extras, [key]: [...(s.extras[key] ?? []), extra] } })),

  removeExtra: (key, idx) =>
    set(s => {
      const list = (s.extras[key] ?? []).filter((_, i) => i !== idx);
      const extras = { ...s.extras };
      if (list.length) extras[key] = list;
      else delete extras[key];
      return { extras };
    }),

  toggleSkip: key =>
    set(s => {
      const skipped = new Set(s.skipped);
      if (skipped.has(key)) skipped.delete(key);
      else skipped.add(key);
      return { skipped };
    }),

  togglePoi: kind => set(s => ({ showPois: { ...s.showPois, [kind]: !s.showPois[kind] } })),
  toggleUnits: () => set(s => ({ imperial: !s.imperial })),
  setImperial: v => set(s => (s.imperial === v ? s : { imperial: v })),
  setHoverPois: ids => set({ hoverPois: ids }),

  // reverse the whole trip: stops reorder, seg-keyed state gets key-flipped
  toggleDirection: () =>
    set(s => {
      const flip = (k: string) =>
        k.startsWith('rest:') ? k : k.split('>').reverse().join('>');
      return {
        reversed: !s.reversed,
        stops: [...s.stops].reverse(),
        selected: s.selected ? flip(s.selected) : null,
        skipped: new Set([...s.skipped].map(flip)),
        extras: Object.fromEntries(
          Object.entries(s.extras).map(([k, v]) => [flip(k), v]),
        ),
      };
    }),

  reset: () =>
    set({
      stops: defaultStops(),
      restAt: {},
      skipped: new Set(),
      extras: {},
      reversed: false,
      selected: null,
    }),
}));

// persist on every change (debounced)
let t: ReturnType<typeof setTimeout>;
usePlanner.subscribe(s => {
  clearTimeout(t);
  t = setTimeout(() => {
    const blob = serialize(s);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(blob));
      history.replaceState(null, '', `#i=${b64encode(blob)}`);
    } catch {
      /* private mode etc. */
    }
  }, 250);
});
