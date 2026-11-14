import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { board, setBoard, NEUHOF, SPACE_COLORS, type BoardData, type Branch } from './board';

// OpenFreeMap: OpenStreetMap-Vektorkacheln inkl. 3D-Gebäuden, ohne API-Key.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const TOKEN_OFFSETS: [number, number][] = [
  [-16, -8],
  [16, -8],
  [-16, 14],
  [16, 14],
];

/** Kreis (bzw. Ellipse) in Metern um einen Punkt, als Polygon-Ring */
function ring(lng: number, lat: number, rx: number, ry = rx, steps = 28): [number, number][] {
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [lng + (Math.cos(a) * rx) / mLng, lat + (Math.sin(a) * ry) / 111320] as [number, number];
  });
}

const BOARD_LAYERS = ['kali', 'board-spaces', 'board-rim', 'board-path', 'board-path-casing'];
const BOARD_SOURCES = ['kali', 'board-spaces', 'board-rim', 'board-path'];

export class CityMap {
  readonly map: maplibregl.Map;
  readonly ready: Promise<void>;
  coords: [number, number][] = [];
  private boardMarkers: maplibregl.Marker[] = [];
  private buildingFilters = new Map<string, unknown>();
  private tokens: { marker: maplibregl.Marker; inner: HTMLElement }[] = [];
  private fruit?: maplibregl.Marker;
  private choiceMarkers: maplibregl.Marker[] = [];

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      center: NEUHOF.center,
      zoom: 14.6,
      pitch: 58,
      bearing: -20,
      maxPitch: 75,
      canvasContextAttributes: { antialias: true },
    });
    this.ready = new Promise((resolve) =>
      this.map.once('load', () => {
        this.partyTheme();
        this.setBoard(NEUHOF);
        resolve();
      }),
    );
  }

  /** Blauer Himmel, sattgrüne Wiesen und bonbonfarbene Häuser: Neuhof als Spielzeugwelt. */
  private partyTheme() {
    const map = this.map;
    try {
      map.setSky({
        'sky-color': '#3fa9ff',
        'horizon-color': '#d9f3ff',
        'fog-color': '#c9f0c0',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.5,
        'fog-ground-blend': 0.2,
      });
      for (const layer of map.getStyle().layers) {
        if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#8fdc6a');
        if (layer.type === 'fill' && /residential|landuse_res|industrial|commercial/.test(layer.id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#a5e67c');
        }
        // Ortsnamen & Co. ausblenden – das Brett bringt eigene Schilder mit
        if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
        if (layer.type !== 'fill-extrusion') continue;
        map.setPaintProperty(layer.id, 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 8],
          0, '#ffd6e8',
          6, '#ffe9a8',
          10, '#ffb3a7',
          16, '#a9def9',
          30, '#d0b8ff',
        ]);
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.95);
        this.buildingFilters.set(layer.id, map.getFilter(layer.id) ?? null);
      }
    } catch (err) {
      console.warn('Party-Look konnte nicht gesetzt werden', err);
    }
  }

  /** Wechselt das Brett: legt Wege, 3D-Felder und Schilder für den Ort neu auf die Karte. */
  setBoard(next: BoardData) {
    const map = this.map;
    setBoard(next);
    this.reset();
    this.boardMarkers.forEach((m) => m.remove());
    this.boardMarkers = [];
    for (const id of BOARD_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of BOARD_SOURCES) if (map.getSource(id)) map.removeSource(id);

    const { spaces: SPACES, paths: PATHS, landmarks: LANDMARKS, center: CENTER } = board;
    this.coords = SPACES.map((s) => [s.lng, s.lat]);

    // Häuser, die direkt auf der Strecke stehen, ausblenden
    this.buildingFilters.forEach((orig, id) => {
      const far = ['>', ['distance', { type: 'MultiLineString', coordinates: PATHS }], 7];
      try {
        map.setFilter(id, (orig ? ['all', orig, far] : far) as any);
      } catch (err) {
        console.warn('Gebäudefilter nicht anwendbar', err);
      }
    });

    // Pixelbreite so skalieren, dass sie einer festen Breite in Metern entspricht.
    const meters = (m: number) => {
      const px = (z: number) => (m * 2 ** z) / (78271.5 * Math.cos((CENTER[1] * Math.PI) / 180));
      return ['interpolate', ['exponential', 2], ['zoom'], 10, px(10), 22, px(22)] as any;
    };

    map.addSource('board-path', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: PATHS } },
    });
    map.addLayer({
      id: 'board-path-casing',
      type: 'line',
      source: 'board-path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#b45309', 'line-width': meters(17) },
    });
    map.addLayer({
      id: 'board-path',
      type: 'line',
      source: 'board-path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffd93d', 'line-width': meters(12) },
    });

    // Felder: weißer Sockel + farbige Scheibe, als echte 3D-Körper
    const disc = (r: number, h: number, base: number) => ({
      type: 'FeatureCollection' as const,
      features: SPACES.map((s) => ({
        type: 'Feature' as const,
        properties: { color: SPACE_COLORS[s.type], h, base },
        geometry: { type: 'Polygon' as const, coordinates: [ring(s.lng, s.lat, r)] },
      })),
    });
    map.addSource('board-rim', { type: 'geojson', data: disc(13, 1.2, 0) });
    map.addSource('board-spaces', { type: 'geojson', data: disc(10.5, 2.6, 1.2) });
    map.addLayer({
      id: 'board-rim',
      type: 'fill-extrusion',
      source: 'board-rim',
      paint: { 'fill-extrusion-color': '#fffdf5', 'fill-extrusion-height': ['get', 'h'] },
    });
    map.addLayer({
      id: 'board-spaces',
      type: 'fill-extrusion',
      source: 'board-spaces',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-vertical-gradient': false,
      },
    });

    // Monte Kali: der weiße Kaliberg als Stufenkegel am Horizont
    const kali = LANDMARKS.find((l) => l.name === 'Monte Kali');
    if (board.neuhof && kali) this.addKali(kali.lng, kali.lat);

    SPACES.forEach((s, i) => {
      const icon = s.type === 'event' ? '❓' : s.type === 'start' ? '🏁' : s.next.length > 1 ? '🔀' : '';
      if (!icon) return;
      const el = document.createElement('div');
      el.className = 'space-icon';
      el.textContent = icon;
      this.boardMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(this.coords[i]).addTo(map));
    });

    for (const l of LANDMARKS) {
      const el = document.createElement('div');
      el.className = 'landmark';
      const icon = document.createElement('span');
      icon.textContent = l.emoji;
      const label = document.createElement('b');
      label.textContent = l.name;
      el.append(icon, label);
      this.boardMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lng, l.lat]).addTo(map));
    }
  }

  private addKali(lng: number, lat: number) {
    const map = this.map;
    const kali = { lng, lat };
    map.addSource('kali', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: Array.from({ length: 9 }, (_, i) => ({
          type: 'Feature' as const,
          properties: { h: 22 * (i + 1), base: 22 * i, color: i > 6 ? '#ffffff' : i % 2 ? '#f3efe6' : '#e6e0d4' },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring(kali.lng, kali.lat, 520 - i * 52, 380 - i * 38, 40)],
          },
        })),
      },
    });
    map.addLayer({
      id: 'kali',
      type: 'fill-extrusion',
      source: 'kali',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'base'],
      },
    });
  }

  /** Entfernt Spielfiguren und Obst (für eine neue Partie). */
  reset() {
    this.tokens.forEach((t) => t.marker.remove());
    this.tokens = [];
    this.fruit?.remove();
    this.fruit = undefined;
    this.clearChoices();
  }

  overview(leftPadding = 0, duration = 3000) {
    const bounds = new maplibregl.LngLatBounds();
    this.coords.forEach((c) => bounds.extend(c));
    this.map.fitBounds(bounds, {
      padding: { top: 70, bottom: 70, right: 50, left: 50 + leftPadding },
      pitch: 52,
      bearing: -20,
      duration,
    });
  }

  focus(space: number, duration = 700, zoom = 17) {
    this.map.easeTo({
      center: this.coords[space],
      zoom,
      pitch: 62,
      bearing: this.map.getBearing() + 3,
      duration,
    });
  }

  /** Zeigt an einer Abzweigung anklickbare Wegweiser auf den Folgefeldern. */
  showChoices(options: Branch[], pick: (index: number) => void) {
    this.clearChoices();
    options.forEach((o, i) => {
      // Äußeres Element gehört MapLibre (Position), die Animation liegt auf dem inneren Knopf
      const el = document.createElement('div');
      el.style.zIndex = '6';
      const btn = document.createElement('button');
      btn.className = 'choice-pin';
      btn.textContent = o.icon;
      btn.title = o.label;
      btn.addEventListener('click', () => pick(i));
      el.append(btn);
      this.choiceMarkers.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -10] }).setLngLat(this.coords[o.to]).addTo(this.map),
      );
    });
  }

  clearChoices() {
    this.choiceMarkers.forEach((m) => m.remove());
    this.choiceMarkers = [];
  }

  addToken(index: number, emoji: string, color: string, space: number) {
    const el = document.createElement('div');
    el.className = 'token';
    const inner = document.createElement('div');
    inner.className = 'token-inner';
    inner.style.background = color;
    inner.textContent = emoji;
    el.append(inner);
    const marker = new maplibregl.Marker({ element: el, offset: TOKEN_OFFSETS[index] })
      .setLngLat(this.coords[space])
      .addTo(this.map);
    this.tokens[index] = { marker, inner };
  }

  setActiveToken(index: number) {
    this.tokens.forEach((t, i) => {
      t.inner.classList.toggle('active', i === index);
      t.marker.getElement().style.zIndex = i === index ? '5' : '2';
    });
  }

  moveToken(index: number, space: number, duration = 300): Promise<void> {
    const { marker, inner } = this.tokens[index];
    const from = marker.getLngLat();
    const [toLng, toLat] = this.coords[space];
    inner.classList.remove('hop');
    void inner.offsetWidth;
    inner.classList.add('hop');
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / duration);
        marker.setLngLat([from.lng + (toLng - from.lng) * k, from.lat + (toLat - from.lat) * k]);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  setFruit(space: number) {
    if (!this.fruit) {
      const el = document.createElement('div');
      el.className = 'fruit';
      el.innerHTML = '<div class="fruit-inner">🍍</div>';
      this.fruit = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -18] });
      this.fruit.setLngLat(this.coords[space]).addTo(this.map);
    } else {
      this.fruit.setLngLat(this.coords[space]);
    }
  }
}
