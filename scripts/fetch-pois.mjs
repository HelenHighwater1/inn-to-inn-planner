// Builds src/data/pois.json: accommodation, food, and towns near the trail.
// Fetches a trail-bounding-box Overpass query (cached in data/raw/), then keeps
// only POIs within MAX_DIST_M of the trail, recording each POI's nearest point
// on the polyline as a fractional trail index.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'pois-osm.json');
const TRAIL = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'trail.json'), 'utf8'));
const OUT = join(ROOT, 'src', 'data', 'pois.json');
const MAX_DIST_M = 2500;
const UA = 'InnToInnPlanner/0.1 (personal hiking planner)';
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const refetch = process.argv.includes('--refetch');
mkdirSync(join(ROOT, 'data', 'raw'), { recursive: true });

const lats = TRAIL.map(p => p.lat), lons = TRAIL.map(p => p.lon);
const pad = 0.04; // ~4km
const bbox = `${Math.min(...lats) - pad},${Math.min(...lons) - pad},${Math.max(...lats) + pad},${Math.max(...lons) + pad}`;
const QUERY = `[out:json][timeout:120];(
  nwr["tourism"~"hotel|guest_house|hostel|bed_and_breakfast|alpine_hut|camp_site|caravan_site|chalet"](${bbox});
  nwr["amenity"~"restaurant|cafe|pub|bar|fast_food|bistro"](${bbox});
  nwr["craft"="distillery"](${bbox});
  nwr["man_made"="distillery"](${bbox});
  nwr["distillery"](${bbox});
  nwr["place"~"city|town|village|hamlet"](${bbox});
);out center tags;`;

async function loadRaw() {
  if (!refetch && existsSync(RAW)) {
    console.log('using cached data/raw/pois-osm.json');
    return JSON.parse(readFileSync(RAW, 'utf8'));
  }
  for (const host of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(QUERY)}`,
      });
      const text = await res.text();
      if (text.startsWith('{')) {
        writeFileSync(RAW, text);
        return JSON.parse(text);
      }
      console.warn(`${host}: non-JSON response, trying next`);
    } catch (e) {
      console.warn(`${host}: ${e.message}, trying next`);
    }
  }
  throw new Error('All Overpass mirrors failed');
}

const K = 111320; // metres per degree lat
const toXY = (lat, lon, lat0) => [lon * K * Math.cos(lat0 * Math.PI / 180), lat * K];

// project point onto trail polyline -> {fracIdx, distM}
function nearestOnTrail(lat, lon) {
  let best = { distM: Infinity, fracIdx: 0 };
  const [px, py] = toXY(lat, lon, lat);
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i], b = TRAIL[i + 1];
    const [ax, ay] = toXY(a.lat, a.lon, a.lat);
    const [bx, by] = toXY(b.lat, b.lon, a.lat);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx - px, cy = ay + t * dy - py;
    const d = Math.hypot(cx, cy);
    if (d < best.distM) best = { distM: d, fracIdx: i + t };
  }
  return best;
}

// interpolate lat/lon at a fractional index on the trail polyline
function positionAt(fracIdx) {
  const i = Math.max(0, Math.min(TRAIL.length - 2, Math.floor(fracIdx)));
  const t = fracIdx - i;
  const a = TRAIL[i], b = TRAIL[i + 1];
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function classify(e) {
  const t = e.tags || {};
  // distilleries first: many also carry tourism=attraction / amenity tags
  if (t.craft === 'distillery' || t.man_made === 'distillery' || (t.distillery && t.distillery !== 'no')) {
    const subtype = !t.product || t.product === 'whisky' ? 'whisky distillery' : `${t.product} distillery`;
    return { kind: 'distillery', subtype };
  }
  if (t.tourism) return { kind: 'accommodation', subtype: t.tourism };
  if (t.amenity) return { kind: 'food', subtype: t.amenity };
  if (t.place) return { kind: 'town', subtype: t.place };
  return null;
}

const raw = await loadRaw();
console.log(`${raw.elements.length} raw OSM elements`);

// collapse a distillery's base name so its site polygon, entrance node, and
// visitor-centre POIs ("Cardhu Distillery Bar", "Speyburn") merge into one
const baseName = n =>
  n
    .toLowerCase()
    .replace(/\b(distiller(y|ies)|visitor|cent(er|re)|shop|bar|the|and)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const seen = new Set();
const distByBase = new Map();
const pois = [];
for (const e of raw.elements) {
  const c = classify(e);
  if (!c) continue;
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null || lon == null) continue;
  const key = `${c.kind}:${e.tags?.name ?? `${e.type}${e.id}`}`;
  if (c.kind === 'town' && seen.has(key)) continue; // dedupe town labels
  seen.add(key);
  const { fracIdx, distM } = nearestOnTrail(lat, lon);
  // distilleries get a wider net — they're detour destinations, not just on-trail stops
  if (distM > (c.kind === 'distillery' ? 5000 : MAX_DIST_M)) continue;
  const t = e.tags ?? {};
  const fb = t['contact:facebook'] ?? t.facebook;
  const facebook = fb
    ? fb.startsWith('http')
      ? fb
      : `https://www.facebook.com/${fb.replace(/^@/, '')}`
    : undefined;
  const website = t.website ?? t['contact:website'] ?? t.url ?? t['contact:url'] ?? facebook;
  const phone = t.phone ?? t['contact:phone'];
  // "popular" proxy for distilleries: visitor tagging or a web/wikipedia/wikidata presence
  const popular =
    c.kind === 'distillery' && !!(t.tourism || website || t.wikipedia || t.wikidata);
  const poi = {
    id: `${e.type[0]}${e.id}`,
    name: t.name ?? null,
    kind: c.kind,
    subtype: c.subtype,
    lat: +lat.toFixed(6),
    lon: +lon.toFixed(6),
    trailIdx: +fracIdx.toFixed(1),
    distToTrailM: Math.round(distM),
    ...(phone ? { phone } : {}),
    ...(popular ? { popular: true } : {}),
    ...(website ? { website } : {}),
    ...(t.image ? { image: t.image } : {}),
    ...(t.wikimedia_commons ? { commons: t.wikimedia_commons } : {}),
    ...(t.wikipedia ? { wikipedia: t.wikipedia } : {}),
    ...(t.wikidata ? { wikidata: t.wikidata } : {}),
  };
  if (poi.kind === 'distillery' && poi.name) {
    const prev = distByBase.get(baseName(poi.name));
    if (prev) {
      // fold into the existing record; prefer the shorter (primary) name
      for (const k of ['website', 'phone', 'image', 'commons', 'wikipedia', 'wikidata'])
        prev[k] ??= poi[k];
      prev.popular = prev.popular || poi.popular;
      if (poi.name.length < prev.name.length) prev.name = poi.name;
      continue;
    }
    distByBase.set(baseName(poi.name), poi);
  }
  pois.push(poi);
}
// manual additions: POIs missing from OSM or beyond the distance catchment
const MANUAL = join(ROOT, 'data', 'manual-pois.json');
if (existsSync(MANUAL)) {
  for (const m of JSON.parse(readFileSync(MANUAL, 'utf8'))) {
    const { fracIdx, distM } = nearestOnTrail(m.lat, m.lon);
    pois.push({
      id: m.id ?? `m-${m.name.toLowerCase().replace(/\W+/g, '-')}`,
      name: m.name,
      kind: m.kind,
      subtype: m.subtype,
      lat: m.lat,
      lon: m.lon,
      trailIdx: +fracIdx.toFixed(1),
      distToTrailM: Math.round(distM),
      ...(m.phone ? { phone: m.phone } : {}),
      ...(m.website ? { website: m.website } : {}),
      ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}),
    });
  }
}

pois.sort((a, b) => a.trailIdx - b.trailIdx);

// ---- photo enrichment (no API keys needed) ----
// sources: OSM `image`/`wikimedia_commons` tags -> Commons FilePath;
// `wikipedia` tag -> pageimages API; `website` tag -> og:image scrape.

const commonsFile = v => {
  // accepts "File:X.jpg", "X.jpg", or a commons URL containing /File:
  const m = v.match(/File:([^|]+)/);
  const name = decodeURIComponent(m ? m[1] : v).trim().replaceAll(' ', '_');
  if (/^Category:/i.test(name)) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=400`;
};

// OSM `image` may be a Commons filename OR a direct URL (mapillary, site photo, etc.)
const imageTagUrl = v => {
  if (/File:/i.test(v) || !/^https?:/i.test(v)) return commonsFile(v);
  return v;
};

// ---- wikidata enrichment ----
// batch wbgetentities for POIs carrying a `wikidata` Q-id; fills missing
// website (P856 official website) and image (P18 -> Commons FilePath).
// for multi-valued P856 prefer the claim qualified as English (P407=Q1860).

async function wikidataLookup(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join('|');
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk}&props=claims&format=json`;
    try {
      const j = await fetch(url, { headers: { 'User-Agent': UA } }).then(r => r.json());
      for (const [id, ent] of Object.entries(j.entities ?? {})) {
        const claims = ent.claims ?? {};
        const sites = claims.P856 ?? [];
        const en =
          sites.find(c =>
            (c.qualifiers?.P407 ?? []).some(q => q.datavalue?.value?.id === 'Q1860'),
          ) ?? sites[0];
        out[id] = {
          site: en?.mainsnak?.datavalue?.value ?? null,
          image: claims.P18?.[0]?.mainsnak?.datavalue?.value ?? null,
        };
      }
    } catch {
      // ignore — missing wikidata data just means less coverage
    }
  }
  return out;
}

async function enrichFromWikidata(list) {
  const ids = [...new Set(list.filter(p => p.wikidata && (!p.website || !p.imageUrl)).map(p => p.wikidata))];
  if (!ids.length) return;
  const wd = await wikidataLookup(ids);
  let sites = 0,
    imgs = 0;
  for (const p of list) {
    const c = p.wikidata ? wd[p.wikidata] : null;
    if (!c) continue;
    if (!p.website && c.site) {
      p.website = c.site;
      sites++;
    }
    if (c.image) {
      p.wdImage = commonsFile(c.image);
      imgs++;
    }
  }
  console.log(`wikidata: ${sites} websites, ${imgs} images from ${ids.length} Q-ids`);
}

async function wikipediaThumb(tag) {
  // tag format "lang:Article_Title"
  const [lang, ...rest] = tag.split(':');
  const title = rest.join(':');
  if (!title) return null;
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
  try {
    const j = await fetch(url, { headers: { 'User-Agent': UA } }).then(r => r.json());
    const page = Object.values(j.query?.pages ?? {})[0];
    return page?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

async function ogImage(site) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(site, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) InnToInnPlanner/0.1' },
      redirect: 'follow',
    });
    clearTimeout(t);
    const html = await res.text();
    // find the og:/twitter: image meta tag (attrs may be unquoted), then its content attr
    const tag = html.match(
      /<meta[^>]+(?:property|name)=["']?(?:og:image|twitter:image)(?=["'\s>])[^>]*>/i,
    )?.[0];
    const m =
      tag?.match(/content\s*=\s*["']([^"']+)["']/i) ?? tag?.match(/content\s*=\s*([^\s>]+)/i);
    if (!m) return null;
    return new URL(m[1], res.url).href; // resolve relative URLs
  } catch {
    return null;
  }
}

// cache og:image lookups so reruns don't refetch every website
const OG_CACHE = join(ROOT, 'data', 'raw', 'og-cache.json');
const ogCache = existsSync(OG_CACHE) ? JSON.parse(readFileSync(OG_CACHE, 'utf8')) : {};

async function enrichImages(list) {
  let done = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(
      list.slice(i, i + CONCURRENCY).map(async p => {
        if (p.image) p.imageUrl = imageTagUrl(p.image);
        if (!p.imageUrl && p.commons) p.imageUrl = commonsFile(p.commons);
        if (!p.imageUrl && p.wikipedia) p.imageUrl = await wikipediaThumb(p.wikipedia);
        if (!p.imageUrl && p.wdImage) p.imageUrl = p.wdImage;
        if (!p.imageUrl && p.website && !/(facebook|instagram)\.com/.test(p.website)) {
          if (p.website in ogCache) p.imageUrl = ogCache[p.website];
          else {
            p.imageUrl = await ogImage(p.website);
            ogCache[p.website] = p.imageUrl;
          }
        }
        done++;
      }),
    );
    process.stdout.write(`\renriching images ${Math.min(done, list.length)}/${list.length}`);
  }
  console.log();
  writeFileSync(OG_CACHE, JSON.stringify(ogCache));
  for (const p of list) {
    delete p.image;
    delete p.commons;
    delete p.wikipedia;
    delete p.wikidata;
    delete p.wdImage;
  }
}

await enrichFromWikidata(pois);
await enrichImages(pois);
console.log('with photos:', pois.filter(p => p.imageUrl).length);
const counts = pois.reduce((m, p) => ((m[p.kind] = (m[p.kind] || 0) + 1), m), {});
console.log(`kept ${pois.length} POIs within ${MAX_DIST_M}m:`, counts);
console.log('unnamed:', pois.filter(p => !p.name).length);

// ---- off-trail detour routes (public Valhalla pedestrian routing) ----
// lodging too far off-trail gets a walked route from the best trail junction
// so the map can draw the side trip. Cached in detour-cache.json; failures
// are NOT cached so a flaky run doesn't poison future ones.
const DETOUR_CACHE = join(ROOT, 'data', 'raw', 'detour-cache.json');
const detourCache = existsSync(DETOUR_CACHE) ? JSON.parse(readFileSync(DETOUR_CACHE, 'utf8')) : {};
const VALHALLA = 'https://valhalla1.openstreetmap.de';

// decode a Valhalla shape (encoded polyline, precision 6) -> [lon,lat][]
function decodePolyline(str) {
  const coords = [];
  let i = 0, lat = 0, lon = 0;
  const dec = () => {
    let r = 0, s = 0, b;
    do {
      b = str.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << s;
      s += 5;
    } while (b >= 0x20);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < str.length) {
    lat += dec();
    lon += dec();
    coords.push([lon / 1e6, lat / 1e6]);
  }
  return coords;
}

const valhallaGet = (service, json) =>
  fetch(`${VALHALLA}/${service}?json=${encodeURIComponent(JSON.stringify(json))}`, {
    headers: { 'User-Agent': UA },
  }).then(r => r.json());

async function detourFor(p) {
  const key = `${p.id}@${p.lat},${p.lon}`;
  if (key in detourCache) return detourCache[key];
  let out = null;
  try {
    // candidate junctions: the snapped point plus samples ~±7km along the trail —
    // the geometrically nearest trail point often isn't the best routable one
    const candIdxs = [-240, -180, -120, -80, -40, 0, 40, 80, 120, 180, 240].map(d =>
      Math.max(0, Math.min(TRAIL.length - 1, Math.round(p.trailIdx + d))),
    );
    const cands = [...new Set(candIdxs)].map(positionAt);
    // phase 1: distance matrix from every junction to the POI -> pick the best
    const mj = await valhallaGet('sources_to_targets', {
      sources: cands.map(c => ({ lat: c.lat, lon: c.lon })),
      targets: [{ lat: p.lat, lon: p.lon }],
      costing: 'pedestrian',
      units: 'kilometres',
    });
    if (!mj.sources_to_targets) throw new Error('bad matrix response');
    const dists = mj.sources_to_targets.map(row => row?.[0]?.distance ?? Infinity);
    const best = dists.reduce((bi, d, i) => (d < dists[bi] ? i : bi), 0);
    if (Number.isFinite(dists[best])) {
      // phase 2: full geometry for the winning junction only
      const rj = await valhallaGet('route', {
        locations: [{ lat: cands[best].lat, lon: cands[best].lon }, { lat: p.lat, lon: p.lon }],
        costing: 'pedestrian',
        units: 'kilometres',
      });
      if (!rj.trip) throw new Error('bad route response');
      // each leg has its own delta-encoded shape — decode separately then concat
      const coords = (rj.trip.legs ?? []).flatMap(l => decodePolyline(l.shape ?? ''));
      if (coords?.length) {
        out = { distM: Math.round((rj.trip.summary?.length ?? 0) * 1000), coords };
      }
    }
    detourCache[key] = out; // definitive answer (route found or none exists)
  } catch {
    // network/API failure — leave uncached so the next run retries
  }
  return out;
}

const farLodging = pois.filter(
  p => p.kind === 'accommodation' && p.distToTrailM > 2000 && p.distToTrailM < 12000,
);
let detoursDone = 0;
for (let i = 0; i < farLodging.length; i += 4) {
  await Promise.all(
    farLodging.slice(i, i + 4).map(async p => {
      const d = await detourFor(p);
      if (d) p.detour = d;
      detoursDone++;
    }),
  );
  process.stdout.write(`\rdetour routes ${Math.min(detoursDone, farLodging.length)}/${farLodging.length}`);
}
console.log();
writeFileSync(DETOUR_CACHE, JSON.stringify(detourCache));
console.log('with detour routes:', pois.filter(p => p.detour).length);

writeFileSync(OUT, JSON.stringify(pois));
console.log(`wrote ${OUT}`);
