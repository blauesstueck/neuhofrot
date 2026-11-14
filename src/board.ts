import data from './board-data.json';

export type SpaceType = 'start' | 'blue' | 'red' | 'event';

export interface Branch {
  /** Index des nächsten Felds */
  to: number;
  label: string;
  icon: string;
}

export interface Space {
  lng: number;
  lat: number;
  type: SpaceType;
  /** Straßenname laut OpenStreetMap */
  street: string;
  /** Folgefelder – mehr als eins bedeutet: Abzweigung, der Spieler wählt */
  next: Branch[];
}

export interface Landmark {
  name: string;
  emoji: string;
  lng: number;
  lat: number;
}

export interface BoardData {
  /** Anzeigename des Orts, z. B. "36119 Neuhof" */
  name: string;
  center: [number, number];
  /** Feld 0 ist immer der Start */
  spaces: Space[];
  /** Straßenverläufe der Strecken, als Linien fürs Zeichnen */
  paths: [number, number][][];
  landmarks: Landmark[];
  /** Das handgebaute Neuhof-Brett (mit Monte Kali und eigenen Ereignissen) */
  neuhof: boolean;
  /** false = Notlösung Rundkurs, weil kein Straßennetz gefunden wurde */
  streets: boolean;
}

const PATTERN = 'BBRBEBBRBBEBRB';
const TYPES: Record<string, SpaceType> = { B: 'blue', R: 'red', E: 'event' };

/** Feldtyp nach festem Muster: Start, Abzweigungen blau, sonst gemischt. */
export function spaceType(i: number, nextCount: number): SpaceType {
  return i === 0 ? 'start' : nextCount > 1 ? 'blue' : TYPES[PATTERN[(i * 5) % PATTERN.length]];
}

// Das Neuhof-Brett liegt auf echten Straßen in 36119 Neuhof und wird von
// scripts/build-board.mjs aus OpenStreetMap-Daten erzeugt (src/board-data.json).
// Bretter für andere Orte baut src/generate.ts zur Laufzeit.
const branches = data.branches as Record<string, { label: string; icon: string }[]>;

export const NEUHOF: BoardData = {
  name: '36119 Neuhof',
  center: [9.6142, 50.4522],
  neuhof: true,
  streets: true,
  spaces: data.nodes.map((n, i) => ({
    lng: n.lng,
    lat: n.lat,
    street: n.street,
    type: spaceType(i, n.next.length),
    next: n.next.map((to, k) => ({ to, label: branches[i]?.[k]?.label ?? '', icon: branches[i]?.[k]?.icon ?? '➡️' })),
  })),
  paths: data.paths as [number, number][][],
  landmarks: [
    { name: 'Rathaus', emoji: '🏛️', lng: 9.61392, lat: 50.45557 },
    { name: 'Bahnhof', emoji: '🚉', lng: 9.62032, lat: 50.45358 },
    { name: 'St. Michael', emoji: '⛪', lng: 9.62178, lat: 50.45038 },
    { name: 'tegut', emoji: '🛒', lng: 9.61144, lat: 50.4529 },
    { name: 'Aldi', emoji: '🛍️', lng: 9.61652, lat: 50.45726 },
    { name: 'Schloss-Schule', emoji: '🏫', lng: 9.61573, lat: 50.45383 },
    { name: 'Feuerwehr', emoji: '🚒', lng: 9.61219, lat: 50.45354 },
    { name: 'Bäckerei', emoji: '🥨', lng: 9.6156, lat: 50.45631 },
    { name: 'Eisdiele', emoji: '🍦', lng: 9.61667, lat: 50.45245 },
    { name: 'Monte Kali', emoji: '⛰️', lng: 9.59375, lat: 50.46784 },
  ],
};

/** Das aktuell gespielte Brett (wechselt, wenn ein anderer Ort gewählt wird). */
export let board: BoardData = NEUHOF;
export function setBoard(b: BoardData) {
  board = b;
}

export const SPACE_COLORS: Record<SpaceType, string> = {
  start: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  event: '#a855f7',
};

export const START_COINS = 10;
export const FRUIT_PRICE = 20;
export const BLUE_COINS = 3;
export const RED_COINS = 3;
export const LAP_BONUS = 10;
export const MINIGAME_PRIZE = 10;
