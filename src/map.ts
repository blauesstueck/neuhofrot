import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { SPACES, SPACE_COLORS, toLngLat } from './board';

// OpenFreeMap: OpenStreetMap-Vektorkacheln inkl. 3D-Gebäuden, ohne API-Key.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export interface GeoResult {
  lng: number;
  lat: number;
  label: string;
}

/** Adresse -> Koordinaten über Nominatim (OpenStreetMap). */
export async function geocode(query: string): Promise<GeoResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding fehlgeschlagen (${res.status})`);
  const data = (await res.json()) as { lon: string; lat: string; display_name: string }[];
  if (!data.length) return null;
  return { lng: +data[0].lon, lat: +data[0].lat, label: data[0].display_name };
}

const TOKEN_OFFSETS: [number, number][] = [
  [-16, -8],
  [16, -8],
  [-16, 14],
  [16, 14],
];

export class CityMap {
  readonly map: maplibregl.Map;
  readonly ready: Promise<void>;
  coords: [number, number][] = [];
  private tokens: { marker: maplibregl.Marker; inner: HTMLElement }[] = [];
  private fruit?: maplibregl.Marker;
  private eventMarkers: maplibregl.Marker[] = [];
  private origFilters = new Map<string, unknown>();

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [13.3777, 52.5163],
      zoom: 15.5,
      pitch: 60,
      bearing: -20,
      maxPitch: 75,
      canvasContextAttributes: { antialias: true },
    });
    this.ready = new Promise((resolve) =>
      this.map.once('load', () => {
        this.candyTheme();
        resolve();
      }),
    );
  }

  /** Lila Abendhimmel + bonbonfarbene Gebäude für den bunten Party-Look. */
  private candyTheme() {
    const map = this.map;
    try {
      map.setSky({
        'sky-color': '#2a1466',
        'horizon-color': '#ff8fc7',
        'fog-color': '#b79cff',
        'sky-horizon-blend': 0.7,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.3,
      });
      for (const layer of map.getStyle().layers) {
        if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#c4ee9f');
        if (layer.type === 'fill' && /residential|landuse_res/.test(layer.id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#d3f2ae');
        }
        if (layer.type !== 'fill-extrusion') continue;
        map.setPaintProperty(layer.id, 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 8],
          0, '#ffd6e8',
          10, '#ffe9a8',
          20, '#ffb3a7',
          35, '#a9def9',
          60, '#d0b8ff',
          120, '#ff9ecf',
        ]);
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.95);
      }
    } catch (err) {
      console.warn('Party-Look konnte nicht gesetzt werden', err);
    }
  }

  /** Baut das (feste) Spielbrett rund um die Koordinate in die echte Stadt. */
  async setCenter(lng: number, lat: number, leftPadding = 0) {
    await this.ready;
    const map = this.map;
    this.coords = SPACES.map((s) => toLngLat(lng, lat, s.x, s.y));

    const path = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [...this.coords, this.coords[0]] },
    };
    const points = {
      type: 'FeatureCollection' as const,
      features: this.coords.map((c, i) => ({
        type: 'Feature' as const,
        properties: { type: SPACES[i].type },
        geometry: { type: 'Point' as const, coordinates: c },
      })),
    };

    // Pixelbreite so skalieren, dass sie einer festen Breite in Metern entspricht.
    const meters = (m: number) => {
      const px = (z: number) => (m * 2 ** z) / (78271.5 * Math.cos((lat * Math.PI) / 180));
      return ['interpolate', ['exponential', 2], ['zoom'], 10, px(10), 22, px(22)] as any;
    };

    for (const id of ['board-spaces', 'board-path', 'board-path-casing']) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ['board-path', 'board-spaces']) {
      if (map.getSource(id)) map.removeSource(id);
    }
    map.addSource('board-path', { type: 'geojson', data: path });
    map.addSource('board-spaces', { type: 'geojson', data: points });
    map.addLayer({
      id: 'board-path-casing',
      type: 'line',
      source: 'board-path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#4c1d95', 'line-width': meters(17) },
    });
    map.addLayer({
      id: 'board-path',
      type: 'line',
      source: 'board-path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#fde68a', 'line-width': meters(12) },
    });
    map.addLayer({
      id: 'board-spaces',
      type: 'circle',
      source: 'board-spaces',
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
        'circle-radius': meters(9),
        'circle-stroke-width': meters(2),
        'circle-stroke-color': '#ffffff',
        'circle-color': [
          'match',
          ['get', 'type'],
          'start', SPACE_COLORS.start,
          'red', SPACE_COLORS.red,
          'event', SPACE_COLORS.event,
          SPACE_COLORS.blue,
        ],
      },
    });

    this.clearBuildingsAlong(path);

    this.eventMarkers.forEach((m) => m.remove());
    this.eventMarkers = [];
    SPACES.forEach((s, i) => {
      if (s.type !== 'event' && s.type !== 'start') return;
      const el = document.createElement('div');
      el.className = 'space-icon';
      el.textContent = s.type === 'event' ? '❓' : '🏁';
      this.eventMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(this.coords[i]).addTo(map));
    });

    this.tokens.forEach((t) => t.marker.remove());
    this.tokens = [];
    this.fruit?.remove();
    this.fruit = undefined;

    this.overview(leftPadding);
  }

  /** Blendet 3D-Gebäude direkt auf der Strecke aus, damit das Brett als Schneise durch die Stadt läuft. */
  private clearBuildingsAlong(path: unknown) {
    const map = this.map;
    for (const layer of map.getStyle().layers) {
      if (layer.type !== 'fill-extrusion') continue;
      if (!this.origFilters.has(layer.id)) this.origFilters.set(layer.id, map.getFilter(layer.id) ?? null);
      const orig = this.origFilters.get(layer.id);
      const far = ['>', ['distance', path], 16];
      try {
        map.setFilter(layer.id, (orig ? ['all', orig, far] : far) as any);
      } catch (err) {
        console.warn('Gebäudefilter nicht anwendbar', err);
      }
    }
  }

  overview(leftPadding = 0, duration = 3000) {
    const bounds = new maplibregl.LngLatBounds();
    this.coords.forEach((c) => bounds.extend(c));
    this.map.fitBounds(bounds, {
      padding: { top: 90, bottom: 90, right: 60, left: 60 + leftPadding },
      pitch: 55,
      bearing: -20,
      duration,
    });
  }

  focus(space: number, duration = 700) {
    this.map.easeTo({
      center: this.coords[space],
      zoom: 17.3,
      pitch: 62,
      bearing: this.map.getBearing() + 3,
      duration,
    });
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
