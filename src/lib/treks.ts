import speysideTrail from '../data/speyside/trail.json';
import speysidePois from '../data/speyside/pois.json';
import greatGlenWayTrail from '../data/great-glen-way/trail.json';
import greatGlenWayPois from '../data/great-glen-way/pois.json';
import type { Poi, TrailPoint } from './trail';

export type TrekId = 'speyside' | 'great-glen-way';

export interface Trek {
  id: TrekId;
  name: string;
  from: string; // start of the forward direction
  to: string; // end of the forward direction
  dirForward: string; // direction-toggle label when hiking from -> to
  dirReverse: string;
  defaultStops: string[]; // names resolved against the trek's candidate stops
  trail: TrailPoint[];
  pois: Poi[];
}

export const TREKS: Record<TrekId, Trek> = {
  speyside: {
    id: 'speyside',
    name: 'Speyside Way',
    from: 'Buckie',
    to: 'Newtonmore',
    dirForward: 'Sea to hills',
    dirReverse: 'Hills to sea',
    defaultStops: [
      'Buckie',
      'Fochabers',
      'Craigellachie',
      'Ballindalloch',
      'Grantown-on-Spey',
      'Aviemore',
      'Newtonmore',
    ],
    trail: speysideTrail as TrailPoint[],
    pois: speysidePois as Poi[],
  },
  'great-glen-way': {
    id: 'great-glen-way',
    name: 'Great Glen Way',
    from: 'Fort William',
    to: 'Inverness',
    dirForward: 'Fort William to Inverness',
    dirReverse: 'Inverness to Fort William',
    defaultStops: [
      'Fort William',
      'Gairlochy',
      'South Laggan',
      'Fort Augustus',
      'Invermoriston',
      'Drumnadrochit',
      'Inverness',
    ],
    trail: greatGlenWayTrail as TrailPoint[],
    pois: greatGlenWayPois as Poi[],
  },
};

export const TREK_LIST = Object.values(TREKS);
export const DEFAULT_TREK: TrekId = 'speyside';
export const isTrekId = (v: unknown): v is TrekId => typeof v === 'string' && v in TREKS;
