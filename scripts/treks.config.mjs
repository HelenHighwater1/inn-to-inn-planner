// Per-trek pipeline config shared by fetch-trail.mjs and fetch-pois.mjs.
// `start` is a coordinate near the desired km-0 trailhead: the assembled
// polyline begins at whichever graph terminal is closest to it.

export const TREKS = {
  speyside: {
    relationId: 1026251, // Speyside Way main line — Buckie to Newtonmore
    start: { lat: 57.677, lon: -2.968 }, // Buckie
    trailOut: 'src/data/speyside/trail.json',
    poisOut: 'src/data/speyside/pois.json',
    rawRel: 'data/raw/speyside-rel.json',
    rawWays: 'data/raw/speyside-ways.json',
    rawPois: 'data/raw/speyside-pois-osm.json',
    manualPois: 'data/manual-pois.speyside.json',
  },
  'great-glen-way': {
    relationId: 126572, // Great Glen Way — Fort William to Inverness
    start: { lat: 56.819, lon: -5.104 }, // Fort William
    trailOut: 'src/data/great-glen-way/trail.json',
    poisOut: 'src/data/great-glen-way/pois.json',
    rawRel: 'data/raw/great-glen-way-rel.json',
    rawWays: 'data/raw/great-glen-way-ways.json',
    rawPois: 'data/raw/great-glen-way-pois-osm.json',
    manualPois: 'data/manual-pois.great-glen-way.json',
  },
};

export function trekArg(argv, treks = TREKS) {
  const id = argv.slice(2).find(a => !a.startsWith('-')) ?? 'speyside';
  const cfg = treks[id];
  if (!cfg) {
    console.error(`unknown trek "${id}" — expected one of: ${Object.keys(treks).join(', ')}`);
    process.exit(1);
  }
  return { id, ...cfg };
}
