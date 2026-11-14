// Baut für einen beliebigen Ort automatisch ein Spielbrett auf den echten Straßen.
// Die Straßen kommen aus den OpenStreetMap-Vektorkacheln, die die Karte ohnehin lädt.
import type maplibregl from 'maplibre-gl';
import { spaceType, type BoardData, type Landmark, type Space } from './board';

export interface Place {
  lng: number;
  lat: number;
  name: string;
}

const PLACE_TYPES = new Set(['village', 'town', 'city', 'suburb', 'hamlet', 'quarter', 'neighbourhood', 'city_district', 'borough']);

/** Ort/PLZ -> Koordinaten über Nominatim (OpenStreetMap). */
export async function geocode(query: string): Promise<Place | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ortssuche fehlgeschlagen (${res.status})`);
  type Hit = { lon: string; lat: string; name: string; addresstype?: string; address?: Record<string, string> };
  const hits = (await res.json()) as Hit[];
  if (!hits.length) return null;
  // Lieber den Ortskern als den Mittelpunkt einer ganzen Gemeinde oder eines PLZ-Gebiets
  const hit = hits.find((h) => PLACE_TYPES.has(h.addresstype ?? '')) ?? hits[0];
  const a = hit.address ?? {};
  const town = a.village ?? a.town ?? a.city ?? a.suburb ?? a.hamlet ?? a.municipality ?? hit.name;
  const plz = a.postcode ?? hits.find((h) => h.address?.postcode)?.address?.postcode;
  return { lng: +hit.lon, lat: +hit.lat, name: plz ? `${plz} ${town}` : town };
}

// ---------------------------------------------------------------- Straßennetz

const ROAD_COST: Record<string, number> = {
  primary: 1, secondary: 1, tertiary: 1, minor: 1, trunk: 1.4, service: 1.7, track: 2.2, path: 1.9,
};
const SKIP_SUB = new Set(['steps', 'platform', 'bridleway']);
const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

class Graph {
  xs: number[] = [];
  ys: number[] = [];
  adj: Map<number, { len: number; cost: number }>[] = [];
  /** Knoten liegt an einer richtigen Straße (nicht nur Feldweg/Fußweg) */
  real: boolean[] = [];
  private keys = new Map<string, number>();

  node(x: number, y: number) {
    const k = `${Math.round(x)},${Math.round(y)}`;
    let id = this.keys.get(k);
    if (id === undefined) {
      id = this.xs.length;
      this.keys.set(k, id);
      this.xs.push(x);
      this.ys.push(y);
      this.adj.push(new Map());
      this.real.push(false);
    }
    return id;
  }
  dist(a: number, b: number) {
    return Math.hypot(this.xs[a] - this.xs[b], this.ys[a] - this.ys[b]);
  }
  link(a: number, b: number, factor: number) {
    if (a === b) return;
    const len = this.dist(a, b);
    const old = this.adj[a].get(b);
    if (!old || old.cost > len * factor) {
      const e = { len, cost: len * factor };
      this.adj[a].set(b, e);
      this.adj[b].set(a, e);
    }
    if (factor === 1) this.real[a] = this.real[b] = true;
  }
  unlink(a: number, b: number) {
    this.adj[a].delete(b);
    this.adj[b].delete(a);
  }

  /**
   * Kacheln schneiden Straßen an ihren Rändern ab, und Einmündungen haben nicht immer
   * einen gemeinsamen Punkt. Lose Enden, die auf einer anderen Straße liegen, werden
   * deshalb dort eingehängt.
   */
  stitch() {
    const CELL = 25;
    const grid = new Map<string, [number, number][]>();
    const put = (a: number, b: number) => {
      const x0 = Math.floor(Math.min(this.xs[a], this.xs[b]) / CELL);
      const x1 = Math.floor(Math.max(this.xs[a], this.xs[b]) / CELL);
      const y0 = Math.floor(Math.min(this.ys[a], this.ys[b]) / CELL);
      const y1 = Math.floor(Math.max(this.ys[a], this.ys[b]) / CELL);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push([a, b]);
        }
    };
    this.adj.forEach((m, a) => m.forEach((_, b) => a < b && put(a, b)));

    for (let p = 0; p < this.xs.length; p++) {
      if (this.adj[p].size !== 1) continue;
      const px = this.xs[p];
      const py = this.ys[p];
      let best: [number, number] | null = null;
      let bd = 1.5;
      const cx = Math.floor(px / CELL);
      const cy = Math.floor(py / CELL);
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let y = cy - 1; y <= cy + 1; y++)
          for (const [a, b] of grid.get(`${x},${y}`) ?? []) {
            if (a === p || b === p || !this.adj[a].has(b)) continue;
            const dx = this.xs[b] - this.xs[a];
            const dy = this.ys[b] - this.ys[a];
            const t = Math.max(0, Math.min(1, ((px - this.xs[a]) * dx + (py - this.ys[a]) * dy) / (dx * dx + dy * dy || 1)));
            const d = Math.hypot(px - this.xs[a] - t * dx, py - this.ys[a] - t * dy);
            if (d < bd) [bd, best] = [d, [a, b]];
          }
      if (!best) continue;
      const [a, b] = best;
      const e = this.adj[a].get(b)!;
      const factor = e.cost / (e.len || 1) || 1;
      this.unlink(a, b);
      this.link(a, p, factor);
      this.link(p, b, factor);
      put(a, p);
      put(p, b);
    }
  }

  /** Kürzester Weg; bereits benutzte Kanten sind teuer, damit Runden sich nicht überlagern. */
  route(src: number, dst: number, used: Set<string>): number[] | null {
    const dist = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, number>();
    const done = new Set<number>();
    const heap: [number, number][] = [[0, src]];
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    const push = (item: [number, number]) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    };
    while (heap.length) {
      const [du, u] = pop();
      if (done.has(u)) continue;
      done.add(u);
      if (u === dst) break;
      this.adj[u].forEach((e, v) => {
        const nd = du + e.cost * (used.has(ek(u, v)) ? 6 : 1);
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
          push([nd, v]);
        }
      });
    }
    if (src !== dst && !prev.has(dst)) return null;
    const out = [dst];
    while (out[out.length - 1] !== src) out.push(prev.get(out[out.length - 1])!);
    return out.reverse();
  }
}

type Line = [number, number][];
const linesOf = (g: { type: string }): Line[] => {
  const c = (g as { coordinates?: unknown }).coordinates;
  return g.type === 'LineString' ? [c as Line] : g.type === 'MultiLineString' ? (c as Line[]) : [];
};

async function settle(map: maplibregl.Map, center: [number, number]) {
  map.stop();
  map.jumpTo({ center, zoom: 14, pitch: 0, bearing: 0 });
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 9000);
    map.once('idle', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ---------------------------------------------------------------- Brett bauen

interface Seg {
  a: number;
  b: number;
  path: number[];
  len: number;
  used?: boolean;
}

const POI_KINDS: { test: RegExp; emoji: string; fallback: string; max: number }[] = [
  { test: /^town_hall\/townhall$/, emoji: '🏛️', fallback: 'Rathaus', max: 1 },
  { test: /^railway\/station$/, emoji: '🚉', fallback: 'Bahnhof', max: 1 },
  { test: /^place_of_worship\//, emoji: '⛪', fallback: 'Kirche', max: 2 },
  { test: /^fire_station\//, emoji: '🚒', fallback: 'Feuerwehr', max: 1 },
  { test: /^school\/school$/, emoji: '🏫', fallback: 'Schule', max: 1 },
  { test: /^grocery\/supermarket$/, emoji: '🛒', fallback: 'Supermarkt', max: 2 },
  { test: /^bakery\//, emoji: '🥨', fallback: 'Bäckerei', max: 1 },
  { test: /^(ice_cream|cafe)\//, emoji: '🍦', fallback: 'Café', max: 1 },
  { test: /^restaurant\//, emoji: '🍕', fallback: 'Restaurant', max: 1 },
  { test: /^(stadium|swimming_pool|castle|museum)\//, emoji: '🏟️', fallback: 'Treffpunkt', max: 1 },
];

/**
 * Sucht rund um den Ort Straßen, legt eine Außenrunde plus Abkürzungen durch die Mitte
 * darauf und macht daraus ein Brett mit Abzweigungen. Findet sich kein brauchbares
 * Straßennetz, gibt es einen einfachen Rundkurs (ovalBoard).
 */
export async function generateBoard(map: maplibregl.Map, place: Place): Promise<BoardData> {
  let center: [number, number] = [place.lng, place.lat];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await settle(map, center);
      const moved = densestSpot(map, center);
      if (!moved) break;
      center = moved;
    }
    return streetBoard(map, center, place.name) ?? ovalBoard(center, place.name);
  } catch (err) {
    console.warn('Straßenbrett fehlgeschlagen, nehme Rundkurs', err);
    return ovalBoard(center, place.name);
  }
}

function projector(center: [number, number]) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((center[1] * Math.PI) / 180);
  return {
    toXY: ([lng, lat]: [number, number]): [number, number] => [(lng - center[0]) * mLng, (lat - center[1]) * mLat],
    toLL: (x: number, y: number): [number, number] => [+(center[0] + x / mLng).toFixed(6), +(center[1] + y / mLat).toFixed(6)],
  };
}

/** Liegt der gefundene Punkt abseits (z. B. Gemeindemittelpunkt im Feld), zum dichtesten Straßenknäuel rücken. */
function densestSpot(map: maplibregl.Map, center: [number, number]): [number, number] | null {
  const { toXY, toLL } = projector(center);
  const CELL = 250;
  const cells = new Map<string, number>();
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
    if (f.properties.class !== 'minor' && f.properties.class !== 'tertiary') continue;
    for (const line of linesOf(f.geometry))
      for (const p of line) {
        const [x, y] = toXY(p);
        const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        cells.set(k, (cells.get(k) ?? 0) + 1);
      }
  }
  const score = (cx: number, cy: number) => {
    let s = 0;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) s += cells.get(`${x},${y}`) ?? 0;
    return s;
  };
  let best = { s: 0, x: 0, y: 0 };
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    const s = score(x, y);
    if (s > best.s) best = { s, x, y };
  }
  const here = Math.max(score(0, 0), score(-1, 0), score(0, -1), score(-1, -1));
  if (best.s === 0 || here > best.s * 0.45) return null;
  const target = toLL((best.x + 0.5) * CELL, (best.y + 0.5) * CELL);
  return Math.hypot(...toXY(target)) > 350 ? target : null;
}

function streetBoard(map: maplibregl.Map, center: [number, number], name: string): BoardData | null {
  const { toXY, toLL } = projector(center);
  const g = new Graph();

  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
    const factor = ROAD_COST[f.properties.class as string];
    if (!factor || SKIP_SUB.has(f.properties.subclass as string)) continue;
    for (const line of linesOf(f.geometry)) {
      let prev = -1;
      for (const p of line) {
        const [x, y] = toXY(p);
        const id = g.node(x, y);
        if (prev >= 0) g.link(prev, id, factor);
        prev = id;
      }
    }
  }
  g.stitch();

  // Zusammenhängende Netze: das mit den meisten Straßen nahe der Mitte gewinnt
  const comp = new Array<number>(g.xs.length).fill(-1);
  const weight: number[] = [];
  for (let s = 0; s < g.xs.length; s++) {
    if (comp[s] >= 0) continue;
    const c = weight.length;
    weight.push(0);
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const u = stack.pop()!;
      if (g.real[u] && Math.hypot(g.xs[u], g.ys[u]) < 700) weight[c]++;
      g.adj[u].forEach((_, v) => {
        if (comp[v] < 0) {
          comp[v] = c;
          stack.push(v);
        }
      });
    }
  }
  const main = weight.indexOf(Math.max(...weight));
  if (main < 0 || weight[main] < 12) return null;

  const snap = (x: number, y: number, maxD: number) => {
    let best = -1;
    let bd = maxD;
    for (let i = 0; i < g.xs.length; i++) {
      if (comp[i] !== main || !g.real[i]) continue;
      const d = Math.hypot(g.xs[i] - x, g.ys[i] - y);
      if (d < bd) [bd, best] = [d, i];
    }
    return best;
  };

  for (const radius of [430, 300, 200]) {
    const ring: number[] = [];
    const K = 7;
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2;
      const n = snap(Math.sin(a) * radius, Math.cos(a) * radius, radius * 0.55);
      if (n >= 0 && !ring.includes(n)) ring.push(n);
    }
    const mid = snap(0, 0, radius * 0.6);
    if (ring.length < 4 || mid < 0) continue;

    const used = new Set<string>();
    const add = (a: number, b: number) => {
      const p = g.route(a, b, used);
      if (!p) return;
      for (let i = 1; i < p.length; i++) used.add(ek(p[i - 1], p[i]));
    };
    ring.forEach((n, i) => add(n, ring[(i + 1) % ring.length]));
    const half = Math.floor(ring.length / 2);
    add(ring[0], mid);
    add(mid, ring[half]);
    if (ring.length >= 6) add(ring[half + 2], mid);

    const board = assemble(g, used, toLL, center, name);
    if (board) {
      board.landmarks = findLandmarks(map, toXY, radius);
      labelBranches(map, board, toXY);
      return board;
    }
  }
  return null;
}

/** Aus den gewählten Straßenstücken ein gerichtetes Brett machen, auf dem man nie in einer Sackgasse landet. */
function assemble(
  g: Graph,
  used: Set<string>,
  toLL: (x: number, y: number) => [number, number],
  center: [number, number],
  name: string,
): BoardData | null {
  const h = new Map<number, Set<number>>();
  for (const k of used) {
    const [a, b] = k.split('_').map(Number);
    if (!h.has(a)) h.set(a, new Set());
    if (!h.has(b)) h.set(b, new Set());
    h.get(a)!.add(b);
    h.get(b)!.add(a);
  }
  // Sackgassen abschneiden
  const leaves = [...h.keys()].filter((n) => h.get(n)!.size === 1);
  while (leaves.length) {
    const n = leaves.pop()!;
    const nb = h.get(n);
    if (!nb || nb.size !== 1) continue;
    const [o] = nb;
    h.delete(n);
    h.get(o)!.delete(n);
    if (h.get(o)!.size === 1) leaves.push(o);
    if (h.get(o)!.size === 0) h.delete(o);
  }
  if (h.size < 3) return null;

  // Strecken zwischen Kreuzungen
  const junctions = new Set([...h.keys()].filter((n) => h.get(n)!.size >= 3));
  if (!junctions.size) junctions.add(h.keys().next().value!);
  const seen = new Set<string>();
  const segs: Seg[] = [];
  for (const j of junctions)
    for (const first of h.get(j)!) {
      if (seen.has(ek(j, first))) continue;
      const path = [j, first];
      seen.add(ek(j, first));
      while (!junctions.has(path[path.length - 1])) {
        const cur = path[path.length - 1];
        const next = [...h.get(cur)!].find((n) => n !== path[path.length - 2])!;
        seen.add(ek(cur, next));
        path.push(next);
      }
      let len = 0;
      for (let i = 1; i < path.length; i++) len += g.dist(path[i - 1], path[i]);
      segs.push({ a: j, b: path[path.length - 1], path, len });
    }

  // Brücken (Strecken, hinter denen man nicht im Kreis zurückkommt) entfernen
  const inc = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (const n of new Set([s.a, s.b])) {
      if (!inc.has(n)) inc.set(n, []);
      inc.get(n)!.push(i);
    }
  });
  const order = new Map<number, number>();
  const low = new Map<number, number>();
  const bridge = new Set<number>();
  let clock = 0;
  const dfs = (u: number, via: number) => {
    order.set(u, clock);
    low.set(u, clock++);
    for (const e of inc.get(u)!) {
      if (e === via) continue;
      const v = segs[e].a === u ? segs[e].b : segs[e].a;
      if (!order.has(v)) {
        dfs(v, e);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > order.get(u)!) bridge.add(e);
      } else low.set(u, Math.min(low.get(u)!, order.get(v)!));
    }
  };
  for (const j of junctions) if (!order.has(j)) dfs(j, -1);

  // Größtes verbleibendes Stück behalten
  const group = new Map<number, number>();
  const groupLen: number[] = [];
  for (const j of junctions) {
    if (group.has(j)) continue;
    const id = groupLen.length;
    groupLen.push(0);
    const stack = [j];
    group.set(j, id);
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of inc.get(u)!) {
        if (bridge.has(e)) continue;
        const v = segs[e].a === u ? segs[e].b : segs[e].a;
        if (!group.has(v)) {
          group.set(v, id);
          stack.push(v);
        }
      }
    }
  }
  segs.forEach((s, i) => !bridge.has(i) && (groupLen[group.get(s.a)!] += s.len));
  const keep = groupLen.indexOf(Math.max(...groupLen));
  const total = groupLen[keep];
  if (total < 700) return null;
  const live = segs.filter((s, i) => !bridge.has(i) && group.get(s.a) === keep);
  const nodes = [...junctions].filter((j) => group.get(j) === keep && live.some((s) => s.a === j || s.b === j));

  // Start = Kreuzung nahe der Ortsmitte
  nodes.sort((p, q) => Math.hypot(g.xs[p], g.ys[p]) - Math.hypot(g.xs[q], g.ys[q]));
  const root = nodes[0];

  // Fahrtrichtungen so wählen, dass man von überall überall hinkommt
  const visited = new Set<number>();
  const orient = (u: number) => {
    visited.add(u);
    for (const s of live) {
      if (s.used || (s.a !== u && s.b !== u)) continue;
      s.used = true;
      if (s.a !== u) {
        s.path.reverse();
        [s.a, s.b] = [s.b, s.a];
      }
      if (!visited.has(s.b)) orient(s.b);
    }
  };
  orient(root);

  // Felder verteilen
  const spacing = Math.min(95, Math.max(55, total / 62));
  const index = new Map(nodes.map((n, i) => [n, i]));
  const raw: { x: number; y: number; next: number[] }[] = nodes.map((n) => ({ x: g.xs[n], y: g.ys[n], next: [] }));
  const paths: [number, number][][] = [];
  for (const s of live) {
    const cum = [0];
    for (let i = 1; i < s.path.length; i++) cum.push(cum[i - 1] + g.dist(s.path[i - 1], s.path[i]));
    const n = Math.max(1, Math.round(s.len / spacing));
    let prev = index.get(s.a)!;
    for (let k = 1; k < n; k++) {
      const target = (s.len * k) / n;
      let i = 1;
      while (cum[i] < target) i++;
      const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const [a, b] = [s.path[i - 1], s.path[i]];
      raw.push({ x: g.xs[a] + (g.xs[b] - g.xs[a]) * t, y: g.ys[a] + (g.ys[b] - g.ys[a]) * t, next: [] });
      raw[prev].next.push(raw.length - 1);
      prev = raw.length - 1;
    }
    raw[prev].next.push(index.get(s.b)!);
    paths.push(s.path.map((p) => toLL(g.xs[p], g.ys[p])));
  }
  if (raw.length < 12 || raw.some((r) => !r.next.length)) return null;

  const spaces: Space[] = raw.map((r, i) => {
    const [lng, lat] = toLL(r.x, r.y);
    return {
      lng,
      lat,
      street: '',
      type: spaceType(i, r.next.length),
      next: r.next.map((to, k) => ({ to, label: `Weg ${k + 1}`, icon: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][k] ?? '➡️' })),
    };
  });
  return { name, center, spaces, paths, landmarks: [], neuhof: false, streets: true };
}

/** Abzweigungen nach dem Straßennamen benennen, in den sie führen. */
function labelBranches(map: maplibregl.Map, board: BoardData, toXY: (p: [number, number]) => [number, number]) {
  const CELL = 40;
  const grid = new Map<string, { x: number; y: number; name: string }[]>();
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' })) {
    const name = f.properties.name as string | undefined;
    if (!name) continue;
    for (const line of linesOf(f.geometry))
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = toXY(line[i - 1]);
        const [bx, by] = toXY(line[i]);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 12));
        for (let s = 0; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps;
          const y = ay + ((by - ay) * s) / steps;
          const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push({ x, y, name });
        }
      }
  }
  const nameAt = (lng: number, lat: number) => {
    const [x, y] = toXY([lng, lat]);
    let best = '';
    let bd = 22;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++)
        for (const p of grid.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) [bd, best] = [d, p.name];
        }
    return best;
  };
  for (const s of board.spaces) s.street = nameAt(s.lng, s.lat);
  for (const s of board.spaces) {
    if (s.next.length < 2) continue;
    s.next.forEach((b, k) => {
      // Länge bis zur nächsten Kreuzung zählen
      let n = 1;
      let cur = b.to;
      while (board.spaces[cur].next.length === 1 && cur !== 0 && n < 99) {
        cur = board.spaces[cur].next[0].to;
        n++;
      }
      const street = board.spaces[b.to].street || s.street || `Weg ${k + 1}`;
      b.label = `${street} · ${n} ${n === 1 ? 'Feld' : 'Felder'}`;
    });
  }
}

function findLandmarks(map: maplibregl.Map, toXY: (p: [number, number]) => [number, number], radius: number): Landmark[] {
  const out: (Landmark & { d: number; kind: number })[] = [];
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' })) {
    if (f.geometry.type !== 'Point') continue;
    const key = `${f.properties.class}/${f.properties.subclass}`;
    const kind = POI_KINDS.findIndex((k) => k.test.test(key));
    if (kind < 0) continue;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    const d = Math.hypot(...toXY([lng, lat]));
    if (d > radius * 1.5) continue;
    let label = ((f.properties.name as string) || POI_KINDS[kind].fallback).trim();
    if (label.length > 20) label = `${label.slice(0, 19)}…`;
    out.push({ name: label, emoji: POI_KINDS[kind].emoji, lng, lat, d, kind });
  }
  out.sort((a, b) => a.d - b.d);
  const picked: typeof out = [];
  for (const l of out) {
    if (picked.length >= 9) break;
    if (picked.filter((p) => p.kind === l.kind).length >= POI_KINDS[l.kind].max) continue;
    // Kacheln liefern denselben Ort teils doppelt
    if (picked.some((p) => p.name === l.name || Math.hypot(...toXY([p.lng, p.lat]).map((v, i) => v - toXY([l.lng, l.lat])[i])) < 45)) continue;
    picked.push(l);
  }
  return picked.map(({ name, emoji, lng, lat }) => ({ name, emoji, lng, lat }));
}

/** Notlösung ohne Straßennetz: ein geschwungener Rundkurs um den Mittelpunkt. */
export function ovalBoard(center: [number, number], name: string): BoardData {
  const { toLL } = projector(center);
  const N = 28;
  const pts = Array.from({ length: N }, (_, i) => {
    const t = (i / N) * Math.PI * 2;
    return toLL(210 * Math.sin(t) * (1 + 0.16 * Math.sin(3 * t)), -150 * Math.cos(t) * (1 + 0.14 * Math.cos(2 * t)));
  });
  return {
    name,
    center,
    neuhof: false,
    streets: false,
    landmarks: [],
    paths: [[...pts, pts[0]]],
    spaces: pts.map(([lng, lat], i) => ({
      lng,
      lat,
      street: '',
      type: spaceType(i, 1),
      next: [{ to: (i + 1) % N, label: '', icon: '➡️' }],
    })),
  };
}
