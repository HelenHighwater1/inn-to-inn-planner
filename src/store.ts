import { create } from 'zustand';
import {
  activeTrek,
  findCandidateByName,
  kmAt,
  lunchPois,
  setActiveTrek,
  snapCandidatePreferTown,
  TRAIL,
  type Poi,
  type Stop,
} from './lib/trail';
import { DEFAULT_TREK, isTrekId, TREKS, type TrekId } from './lib/treks';

/** A visit/note added to a specific day — a POI reference or free text. */
export interface Extra {
  poiId?: string;
  text?: string;
}

interface PlannerState {
  trek: TrekId; // which trail the itinerary is for
  stops: Stop[]; // in walking order (trailIdx, descending when reversed); first/last are the trip endpoints
  restAt: Record<string, number>; // stop id -> rest days (extra nights) on arrival
  skipped: Set<string>; // segment keys done by cab
  extras: Record<string, Extra[]>; // day key ("idA>idB" or "rest:{id}") -> visits/notes
  lunch: Record<string, string>; // segment key -> chosen lunch POI id
  reversed: boolean; // hiking direction: false = Buckie → Newtonmore
  imperial: boolean;
  selected: string | null; // selected day: segment key "idA>idB" or "rest:{stopId}"
  focusSeg: { key: string; seq: number } | null; // table -> map fly-to request
  focusStop: { id: string; seq: number } | null; // zoom to a stop
  showPois: { accommodation: boolean; food: boolean; town: boolean; distillery: boolean };
  hoverPois: string[] | null; // poi ids to highlight on the map (e.g. lunch hover)
  setTrek: (id: TrekId) => void;
  selectDay: (key: string) => void;
  focusSegment: (key: string) => void;
  openStop: (id: string) => void;
  setLodging: (stopId: string, poiId: string | null) => void;
  setLunch: (segKey: string, poiId: string | null) => void;
  addStop: (fracIdx: number, poi?: Poi) => void;
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
  const names = activeTrek().defaultStops;
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
  t?: TrekId; // trek this itinerary belongs to (absent = speyside, pre-multi-trek links)
  s: [number, string, string, string?][];
  r: Record<string, number> | string[]; // v2: id -> rest days; v1 tolerated (array of ids)
  k: string[];
  e: Record<string, Extra[]>;
  l?: Record<string, string>;
  d: 0 | 1;
  u: 0 | 1;
}
const lsKey = (trek: TrekId) => `${trek}-itinerary-v1`; // speyside keeps the original key
const LS_TREK = 'inn-to-inn-trek'; // last-viewed trek

const trailOrder = (reversed: boolean) => (a: Stop, b: Stop) =>
  reversed ? b.trailIdx - a.trailIdx : a.trailIdx - b.trailIdx;

/** Re-key lunch picks onto the adjacent segment that still offers the POI; drop picks with none. */
function reconcileLunch(stops: Stop[], lunch: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(lunch).flatMap(([, poiId]) => {
      const i = stops.findIndex(
        (st, j) =>
          j < stops.length - 1 &&
          lunchPois(st.trailIdx, stops[j + 1].trailIdx).some(p => p.id === poiId),
      );
      return i >= 0 ? [[`${stops[i].id}>${stops[i + 1].id}`, poiId]] : [];
    }),
  );
}

function serialize(s: PlannerState): Persisted {
  return {
    t: s.trek,
    s: s.stops.map(st => [+st.trailIdx.toFixed(1), st.name, st.kind, st.lodgingId]),
    r: s.restAt,
    k: [...s.skipped],
    e: s.extras,
    l: s.lunch,
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

type RouteState = Pick<
  PlannerState,
  'stops' | 'restAt' | 'skipped' | 'extras' | 'lunch' | 'reversed' | 'imperial'
>;

function readLsBlob(trek: TrekId): Persisted | null {
  try {
    const ls = localStorage.getItem(lsKey(trek));
    return ls ? (JSON.parse(ls) as Persisted) : null;
  } catch {
    return null;
  }
}

/** Planner fields decoded from a persisted blob, or defaults for the active trek. */
function stateFromBlob(blob: Persisted | null): RouteState {
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
      : Object.fromEntries(
          Object.entries(blob.r ?? {}).filter(([, v]) => Number.isFinite(v) && v >= 0),
        );
    return {
      stops,
      restAt,
      skipped: new Set(blob.k ?? []),
      extras: blob.e ?? {},
      lunch: blob.l ?? {},
      reversed: blob.d === 1,
      imperial: blob.u === 1,
    };
  }
  return {
    stops: defaultStops(),
    restAt: {},
    skipped: new Set(),
    extras: {},
    lunch: {},
    reversed: false,
    imperial: true,
  };
}

/** Route state for a trek: its localStorage blob, falling back to default stops. */
function loadTrekState(trek: TrekId): RouteState {
  setActiveTrek(trek); // must precede defaultStops()/blob decode — both read the active dataset
  return stateFromBlob(readLsBlob(trek));
}

function loadInitial(): RouteState & { trek: TrekId } {
  let blob: Persisted | null = null;
  try {
    const h = location.hash;
    if (h.startsWith('#i=')) blob = b64decode(h.slice(3)) as Persisted;
  } catch {
    blob = null;
  }
  let trek: TrekId;
  if (blob) trek = isTrekId(blob.t) ? blob.t : DEFAULT_TREK;
  else {
    const last = localStorage.getItem(LS_TREK);
    trek = isTrekId(last) ? last : DEFAULT_TREK;
    blob = readLsBlob(trek);
  }
  setActiveTrek(trek);
  return { trek, ...stateFromBlob(blob) };
}

const initial = loadInitial();

export const usePlanner = create<PlannerState>((set, get) => ({
  ...initial,
  selected: null,
  focusSeg: null,
  focusStop: null,
  showPois: { accommodation: true, food: true, town: false, distillery: false },
  hoverPois: null,

  // switch treks: flush the outgoing plan to its own key, then load the new trek's
  setTrek: id => {
    const s = get();
    if (id === s.trek || !(id in TREKS)) return;
    try {
      localStorage.setItem(lsKey(s.trek), JSON.stringify(serialize(s)));
    } catch {
      /* private mode etc. */
    }
    set({
      trek: id,
      ...loadTrekState(id),
      imperial: s.imperial,
      selected: null,
      focusSeg: null,
      focusStop: null,
    });
  },

  // selecting a day card: highlight on the map and fly to the segment
  selectDay: key =>
    set(s => ({
      selected: key,
      focusSeg: { key, seq: (s.focusSeg?.seq ?? 0) + 1 },
    })),

  focusSegment: key => set(s => ({ focusSeg: { key, seq: (s.focusSeg?.seq ?? 0) + 1 } })),
  // zooming to a stop is for choosing where to sleep, so make sure lodging is on the map
  openStop: id =>
    set(s => ({
      focusStop: { id, seq: (s.focusStop?.seq ?? 0) + 1 },
      showPois: s.showPois.accommodation ? s.showPois : { ...s.showPois, accommodation: true },
    })),

  setLodging: (stopId, poiId) =>
    set(s => ({
      stops: s.stops.map(st =>
        st.id === stopId ? { ...st, lodgingId: poiId ?? undefined } : st,
      ),
    })),

  setLunch: (segKey, poiId) =>
    set(s => {
      const lunch = { ...s.lunch };
      if (poiId) lunch[segKey] = poiId;
      else delete lunch[segKey];
      return { lunch };
    }),

  addStop: (fracIdx, poi) => {
    const stop = poi ? makeStopFromPoi(poi) : makeStop(fracIdx, get().imperial);
    set(s => {
      if (s.stops.some(x => x.id === stop.id)) return s;
      const stops = [...s.stops, stop].sort(trailOrder(s.reversed));
      return { stops, lunch: reconcileLunch(stops, s.lunch) };
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
        lunch: reconcileLunch(stops, s.lunch),
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
        lunch: Object.fromEntries(Object.entries(s.lunch).map(([k, v]) => [flip(k), v])),
      };
    }),

  reset: () =>
    set({
      stops: defaultStops(),
      restAt: {},
      skipped: new Set(),
      extras: {},
      lunch: {},
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
      localStorage.setItem(lsKey(s.trek), JSON.stringify(blob));
      localStorage.setItem(LS_TREK, s.trek);
      history.replaceState(null, '', `#i=${b64encode(blob)}`);
    } catch {
      /* private mode etc. */
    }
  }, 250);
});
