// Baut das Spielbrett aus echten OpenStreetMap-Straßen in 36119 Neuhof.
// Aufruf: node scripts/build-board.mjs   ->  schreibt src/board-data.json
//
// Das Brett besteht aus Strecken (SEGMENTS) zwischen Kreuzungen (JUNCTIONS).
// Jede Strecke wird über Wegpunkte auf dem Straßennetz geroutet und dann
// gleichmäßig in Felder unterteilt. Zum Umbauen: Wegpunkte ändern, neu ausführen.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(here, 'data', 'map.json');
const OUT = path.join(here, '..', 'src', 'board-data.json');
const BBOX = '9.598,50.444,9.636,50.466';
const SPACING = 78; // Meter zwischen zwei Feldern

const JUNCTIONS = {
  rathaus: [9.6141, 50.4551], // Lindenplatz am Rathaus – Start
  zollweg: [9.6139, 50.4542], // Hanauer Straße / Zollweg
  markt: [9.6163, 50.4528], // Zollweg / Fliedeweg
  frankfurter: [9.617, 50.4524], // Zollweg / Frankfurter Straße
  garten: [9.6128, 50.4506], // Frankfurter Straße / Am Neuen Garten
  baumgarten: [9.6128, 50.4531], // Hanauer Straße / Am Baumgarten
};

/** from/to = Kreuzung, via = Wegpunkte dazwischen, label = Name für die Abzweig-Auswahl */
const SEGMENTS = [
  { from: 'rathaus', to: 'markt', label: 'Nordrunde · Fuldaer Straße', icon: '🥨',
    via: [[9.616, 50.457], [9.6182, 50.4568], [9.6172, 50.4536]] },
  { from: 'zollweg', to: 'rathaus', label: 'Zum Rathaus (Start)', icon: '🏁', via: [] },
  { from: 'zollweg', to: 'markt', label: 'Abkürzung · Zollweg', icon: '⚡', via: [] },
  { from: 'markt', to: 'frankfurter', label: 'Zollweg', icon: '➡️', via: [] },
  { from: 'frankfurter', to: 'garten', label: 'Abkürzung · Frankfurter Straße', icon: '⚡', via: [] },
  { from: 'frankfurter', to: 'garten', label: 'Südrunde · Bahnhof & St. Michael', icon: '⛪',
    via: [[9.6205, 50.4509], [9.6196, 50.4498], [9.6155, 50.4478], [9.6105, 50.4477]] },
  { from: 'garten', to: 'baumgarten', label: 'Hanauer Straße', icon: '➡️', via: [[9.6107, 50.4508]] },
  { from: 'baumgarten', to: 'zollweg', label: 'Geradeaus · Hanauer Straße', icon: '⚡', via: [] },
  { from: 'baumgarten', to: 'rathaus', label: 'Westrunde · tegut', icon: '🛒',
    via: [[9.6075, 50.4522], [9.6117, 50.4547]] },
];

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.hypot(x, y) * R;
}

async function loadOsm() {
  if (!existsSync(CACHE)) {
    console.log('Lade OSM-Daten…');
    const res = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX}`, {
      headers: { 'User-Agent': 'board-builder/0.1 (local dev script)' },
    });
    if (!res.ok) throw new Error(`OSM-Download fehlgeschlagen: ${res.status}`);
    await mkdir(path.dirname(CACHE), { recursive: true });
    await writeFile(CACHE, await res.text());
  }
  return JSON.parse(await readFile(CACHE, 'utf8'));
}

const SKIP = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'steps', 'proposed', 'construction', 'platform', 'corridor']);
const COST = { footway: 1.6, path: 1.6, service: 1.5, track: 1.8, pedestrian: 1.2, cycleway: 1.4 };

const osm = await loadOsm();
const pos = new Map();
for (const e of osm.elements) if (e.type === 'node') pos.set(e.id, [e.lon, e.lat]);

const adj = new Map(); // id -> [{to, w, len, name}]
const snappable = new Set(); // nur Knoten an benannten, richtigen Straßen
const link = (a, b, w, len, name) => {
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push({ to: b, w, len, name });
};
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.tags?.highway || SKIP.has(e.tags.highway)) continue;
  if (e.tags.access === 'private') continue;
  const k = COST[e.tags.highway] ?? 1;
  for (let i = 1; i < e.nodes.length; i++) {
    const a = e.nodes[i - 1];
    const b = e.nodes[i];
    if (!pos.has(a) || !pos.has(b)) continue;
    const len = dist(pos.get(a), pos.get(b));
    link(a, b, len * k, len, e.tags.name ?? '');
    link(b, a, len * k, len, e.tags.name ?? '');
    if (k === 1 && e.tags.name) snappable.add(a).add(b);
  }
}

function snap(p) {
  let best = null;
  let bd = Infinity;
  for (const id of adj.keys()) {
    const d = dist(p, pos.get(id));
    if (d < bd) [bd, best] = [d, id];
  }
  return best;
}

function route(a, b) {
  const d = new Map([[a, 0]]);
  const prev = new Map();
  const done = new Set();
  const heap = [[0, a]];
  while (heap.length) {
    let mi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i;
    const [du, u] = heap.splice(mi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === b) break;
    for (const e of adj.get(u) ?? []) {
      const nd = du + e.w;
      if (nd < (d.get(e.to) ?? Infinity)) {
        d.set(e.to, nd);
        prev.set(e.to, { from: u, name: e.name });
        heap.push([nd, e.to]);
      }
    }
  }
  if (!prev.has(b) && a !== b) throw new Error('Keine Route gefunden');
  const out = [];
  for (let u = b; u !== a; u = prev.get(u).from) out.push({ id: u, name: prev.get(u).name });
  return out.reverse();
}

const jIds = Object.fromEntries(Object.entries(JUNCTIONS).map(([k, p]) => [k, snap(p)]));
const jIndex = Object.fromEntries(Object.keys(JUNCTIONS).map((k, i) => [k, i]));

const nodes = Object.keys(JUNCTIONS).map((k) => ({
  lng: pos.get(jIds[k])[0],
  lat: pos.get(jIds[k])[1],
  next: [],
  street: '',
  junction: k,
}));
const paths = [];
const branches = {};

for (const seg of SEGMENTS) {
  const stops = [jIds[seg.from], ...seg.via.map(snap), jIds[seg.to]];
  const line = [{ id: stops[0], p: pos.get(stops[0]), name: '' }];
  for (let i = 1; i < stops.length; i++) {
    for (const s of route(stops[i - 1], stops[i])) {
      // Stichfahrten (hin und zurück zu einem Wegpunkt) wieder herausschneiden
      const seen = line.findIndex((l) => l.id === s.id);
      if (seen >= 0) line.length = seen + 1;
      else line.push({ id: s.id, p: pos.get(s.id), name: s.name });
    }
  }
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1].p, line[i].p));
  const total = cum.at(-1);
  const n = Math.max(1, Math.round(total / SPACING));
  let prevIdx = jIndex[seg.from];
  const first = nodes.length;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    let i = 1;
    while (cum[i] < target) i++;
    const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const a = line[i - 1].p;
    const b = line[i].p;
    nodes.push({ lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, next: [], street: line[i].name });
    nodes[prevIdx].next.push(nodes.length - 1);
    prevIdx = nodes.length - 1;
  }
  nodes[prevIdx].next.push(jIndex[seg.to]);
  (branches[jIndex[seg.from]] ??= []).push({ first, label: seg.label, icon: seg.icon });
  paths.push(line.map((l) => l.p.map((v) => +v.toFixed(6))));

  const names = [];
  for (const l of line) if (l.name && names.at(-1) !== l.name) names.push(l.name);
  console.log(`${seg.label}: ${Math.round(total)} m, ${n} Felder\n   ${names.join(' → ')}`);
}

for (const n of nodes) {
  n.lng = +n.lng.toFixed(6);
  n.lat = +n.lat.toFixed(6);
}
// Kreuzungen übernehmen den Straßennamen des ersten Folgefelds
for (const n of nodes) if (!n.street) n.street = nodes[n.next[0]].street;

await writeFile(OUT, JSON.stringify({ nodes, paths, branches }, null, 1));
console.log(`\n${nodes.length} Felder -> ${path.relative(process.cwd(), OUT)}`);
