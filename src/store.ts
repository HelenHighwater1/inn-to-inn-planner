import { create } from 'zustand';
import {
  findCandidateByName,
  kmAt,
  snapCandidatePreferTown,
  TRAIL,
  type Poi,
  type Stop,
} from './lib/trail';

interface PlannerState {
  stops: Stop[]; // sorted by trailIdx; first/last are the trip endpoints
  restAt: Set<string>; // stop ids that get a rest day on arrival
  skipped: Set<string>; // segment keys done by cab
  imperial: boolean;
  selected: string | null; // selected day: segment key "idA>idB" or "rest:{stopId}"
  focusSeg: { key: string; seq: number } | null; // table -> map fly-to request
  focusStop: { id: string; seq: number; pan: boolean } | null; // open stop popup; pan = also fly to the stop
  showPois: { accommodation: boolean; food: boolean; town: boolean; distillery: boolean };
  selectDay: (key: string, endStopId?: string) => void;
  focusSegment: (key: string) => void;
  openStop: (id: string) => void;
  setLodging: (stopId: string, poiId: string | null) => void;
  addStop: (fracIdx: number, poi?: Poi) => void;
  moveStop: (id: string, fracIdx: number) => void;
  removeStop: (id: string) => void;
  toggleRest: (stopId: string) => void;
  toggleSkip: (key: string) => void;
  togglePoi: (kind: 'accommodation' | 'food' | 'town' | 'distillery') => void;
  toggleUnits: () => void;
  setImperial: (v: boolean) => void;
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
  r: string[];
  k: string[];
  u: 0 | 1;
}
const LS_KEY = 'speyside-itinerary-v1';

function serialize(s: PlannerState): Persisted {
  return {
    s: s.stops.map(st => [+st.trailIdx.toFixed(1), st.name, st.kind, st.lodgingId]),
    r: [...s.restAt],
    k: [...s.skipped],
    u: s.imperial ? 1 : 0,
  };
}

function b64encode(o: object): string {
  return btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function b64decode(s: string): object {
  return JSON.parse(atob(s.replaceAll('-', '+').replaceAll('_', '/')));
}

function loadInitial(): Pick<PlannerState, 'stops' | 'restAt' | 'skipped' | 'imperial'> {
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
      .sort((a, b) => a.trailIdx - b.trailIdx);
    return {
      stops,
      restAt: new Set(blob.r ?? []),
      skipped: new Set(blob.k ?? []),
      imperial: blob.u === 1,
    };
  }
  return { stops: defaultStops(), restAt: new Set(), skipped: new Set(), imperial: false };
}

const initial = loadInitial();

export const usePlanner = create<PlannerState>((set, get) => ({
  ...initial,
  selected: null,
  focusSeg: null,
  focusStop: null,
  showPois: { accommodation: true, food: false, town: true, distillery: true },

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
      return { stops: [...s.stops, stop].sort((a, b) => a.trailIdx - b.trailIdx) };
    });
  },

  moveStop: (id, fracIdx) => {
    const snapped = makeStop(fracIdx, get().imperial);
    set(s => {
      const others = s.stops.filter(x => x.id !== id);
      // keep identity id so the dragged marker stays associated
      const moved: Stop = { ...snapped, id };
      return { stops: [...others, moved].sort((a, b) => a.trailIdx - b.trailIdx) };
    });
  },

  removeStop: id => {
    set(s => {
      const stops = s.stops.filter(x => x.id !== id);
      if (stops.length < 2) return s;
      const ids = new Set(stops.map(x => x.id));
      const selGone =
        s.selected !== null &&
        s.selected
          .split('>')
          .some(part => !ids.has(part.startsWith('rest:') ? part.slice(5) : part));
      return {
        stops,
        selected: selGone ? null : s.selected,
        restAt: new Set([...s.restAt].filter(r => ids.has(r))),
        skipped: new Set(
          [...s.skipped].filter(k => k.split('>').every(x => ids.has(x))),
        ),
      };
    });
  },

  toggleRest: id =>
    set(s => {
      const restAt = new Set(s.restAt);
      if (restAt.has(id)) restAt.delete(id);
      else restAt.add(id);
      return { restAt };
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

  reset: () =>
    set({ stops: defaultStops(), restAt: new Set(), skipped: new Set(), selected: null }),
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
