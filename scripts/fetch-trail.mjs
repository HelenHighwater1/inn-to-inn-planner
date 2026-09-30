// Builds the trail polyline for a trek (default: speyside; see treks.config.mjs).
// Steps: assemble member ways -> densify to ~100m -> attach elevation (OpenTopoData)
// -> smooth -> write [{lat,lng,ele,cumDistKm}]. Uses cached files in data/raw/ when
// present; pass --refetch to update them from Overpass.
//
//   node scripts/fetch-trail.mjs [trek] [--refetch]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trekArg } from './treks.config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const TREK = trekArg(process.argv);
const OUT = join(ROOT, TREK.trailOut);
const REL_ID = TREK.relationId;
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'InnToInnPlanner/0.1 (personal hiking planner)';

const refetch = process.argv.includes('--refetch');
mkdirSync(RAW, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

async function overpass(query) {
  for (const host of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await res.text();
      if (text.startsWith('{')) return JSON.parse(text);
      console.warn(`${host}: non-JSON response, trying next mirror`);
    } catch (e) {
      console.warn(`${host}: ${e.message}, trying next mirror`);
    }
  }
  throw new Error('All Overpass mirrors failed');
}

async function loadRaw() {
  const relPath = join(ROOT, TREK.rawRel);
  const waysPath = join(ROOT, TREK.rawWays);
  if (!refetch && existsSync(relPath) && existsSync(waysPath)) {
    console.log('using cached data/raw files');
    return {
      rel: JSON.parse(readFileSync(relPath, 'utf8')),
      ways: JSON.parse(readFileSync(waysPath, 'utf8')),
    };
  }
  console.log('fetching relation + way geometry from Overpass...');
  const rel = await overpass(`[out:json][timeout:90];relation(${REL_ID});out body;`);
  const ways = await overpass(`[out:json][timeout:90];relation(${REL_ID})->.a;way(r.a);out geom;`);
  writeFileSync(relPath, JSON.stringify(rel));
  writeFileSync(waysPath, JSON.stringify(ways));
  return { rel, ways };
}

// Walk the endpoint graph of member ways. The ways are unordered in the relation
// and ideally form one simple path, but a route can span several components
// (e.g. a short mapping gap) — on a dead end we hop to the nearest unused
// terminal and keep going toward the goal.
function assemble(_rel, waysData) {
  const ways = waysData.elements.filter(e => e.type === 'way');
  const wayById = new Map(ways.map(w => [w.id, w]));
  const adj = new Map(); // endpoint nodeRef -> [{wayId, otherEnd}]
  const addAdj = (k, v) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(v); };
  for (const w of ways) {
    const s = w.nodes[0], e = w.nodes[w.nodes.length - 1];
    addAdj(s, { wayId: w.id, otherEnd: e });
    addAdj(e, { wayId: w.id, otherEnd: s });
  }
  const terminals = [...adj.entries()].filter(([, v]) => v.length === 1).map(([k]) => k);
  if (terminals.length !== 2) {
    console.warn(`expected 2 terminals, found ${terminals.length} — graph may have branches/gaps`);
  }
  // start at the terminal nearest the trek's configured trailhead; the far
  // trailhead is the terminal farthest from it
  const nodePos = new Map();
  for (const w of ways) {
    nodePos.set(w.nodes[0], w.geometry[0]);
    nodePos.set(w.nodes[w.nodes.length - 1], w.geometry[w.geometry.length - 1]);
  }
  terminals.sort(
    (a, b) => dist(nodePos.get(a), TREK.start) - dist(nodePos.get(b), TREK.start),
  );
  let at = terminals[0];
  const goal = terminals[terminals.length - 1];
  const used = new Set();
  const chain = [];
  while (at !== goal) {
    const next = (adj.get(at) ?? []).find(x => !used.has(x.wayId));
    if (!next) {
      // dead end — pick up the nearest terminal of an unused component
      const cand = terminals.filter(t => adj.get(t)?.some(x => !used.has(x.wayId)));
      if (!cand.length) { console.warn(`dead end before goal at node ${at}`); break; }
      cand.sort(
        (a, b) => dist(nodePos.get(a), nodePos.get(at)) - dist(nodePos.get(b), nodePos.get(at)),
      );
      console.warn(
        `graph gap: hopping ${(dist(nodePos.get(at), nodePos.get(cand[0])) * 1000).toFixed(0)}m to next component`,
      );
      at = cand[0];
      continue;
    }
    const w = wayById.get(next.wayId);
    const reversed = w.nodes[0] !== at;
    chain.push({ id: w.id, reversed });
    used.add(w.id);
    at = next.otherEnd;
  }
  const unused = ways.filter(w => !used.has(w.id));
  if (unused.length) console.warn(`unused ways: ${unused.length}`);
  console.log(`assembled ${chain.length}/${ways.length} ways`);

  const pts = [];
  for (const { id, reversed } of chain) {
    const geom = wayById.get(id).geometry;
    const seq = reversed ? [...geom].reverse() : geom;
    for (const p of seq) {
      const last = pts[pts.length - 1];
      if (!last || last.lat !== p.lat || last.lon !== p.lon) pts.push({ lat: p.lat, lon: p.lon });
    }
  }
  return pts;
}

// haversine km
const dist = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// densify so no segment exceeds maxStepKm
function densify(pts, maxStepKm = 0.1) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    const n = Math.max(1, Math.ceil(d / maxStepKm));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  return out;
}

async function attachElevation(pts) {
  const ds = 'eudem25m,mapzen';
  const batch = 100;
  for (let i = 0; i < pts.length; i += batch) {
    const chunk = pts.slice(i, i + batch);
    const locs = chunk.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const url = `https://api.opentopodata.org/v1/${ds}?locations=${encodeURIComponent(locs)}&interpolation=bilinear`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 'OK') throw new Error(`OpenTopoData error: ${json.error || res.status}`);
    json.results.forEach((r, k) => { chunk[k].ele = r.elevation; });
    if (i + batch < pts.length) await new Promise(r => setTimeout(r, 1100)); // ~1 req/s courtesy
    process.stdout.write(`\relevation ${Math.min(i + batch, pts.length)}/${pts.length}`);
  }
  console.log();
  const nulls = pts.filter(p => p.ele == null);
  if (nulls.length) {
    console.warn(`${nulls.length} points missing elevation — interpolating`);
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].ele == null) {
        const prev = [...pts.slice(0, i)].reverse().find(p => p.ele != null);
        const next = pts.slice(i + 1).find(p => p.ele != null);
        pts[i].ele = prev?.ele ?? next?.ele ?? 0;
      }
    }
  }
}

function smooth(pts, window = 5) {
  const ele = pts.map(p => p.ele);
  const med = pts.map((_, i) => {
    const s = ele.slice(Math.max(0, i - window), i + window + 1).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
  pts.forEach((p, i) => (p.ele = med[i]));
}

const { rel, ways } = await loadRaw();
let pts = assemble(rel, ways);
const rawKm = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
const maxJump = Math.max(...pts.slice(1).map((p, i) => dist(pts[i], p)));
console.log(`raw polyline: ${pts.length} pts, ${rawKm.toFixed(1)} km, max gap ${(maxJump * 1000).toFixed(0)} m`);
if (maxJump > 0.5) console.warn('WARNING: large gap in assembled polyline — check way ordering');

pts = densify(pts, 0.1);
console.log(`densified: ${pts.length} pts`);
await attachElevation(pts);
smooth(pts);

let cum = 0;
const out = pts.map((p, i) => {
  if (i > 0) cum += dist(pts[i - 1], p);
  return { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: Math.round(p.ele), cumDistKm: +cum.toFixed(3) };
});
const gain = out.slice(1).reduce((s, p, i) => s + Math.max(0, p.ele - out[i].ele), 0);
console.log(`total: ${cum.toFixed(1)} km, ${out.length} pts, gain ${gain.toFixed(0)} m`);
console.log(`start ${out[0].lat},${out[0].lon}  end ${out.at(-1).lat},${out.at(-1).lon}`);
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}`);
