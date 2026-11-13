export type SpaceType = 'start' | 'blue' | 'red' | 'event';

export interface Space {
  /** Meter nach Osten vom Mittelpunkt (der eingegebenen Adresse) */
  x: number;
  /** Meter nach Norden vom Mittelpunkt */
  y: number;
  type: SpaceType;
}

// Festgelegtes Brett: ein Rundkurs um die Adresse. S=Start, B=Blau, R=Rot, E=Ereignis.
// Um das Brett zu ändern: PATTERN anpassen oder SPACES direkt als Liste definieren.
const PATTERN = 'SBBRBEBBRBBEBRBBEBRBBEBBRBEB';
const TYPES: Record<string, SpaceType> = { S: 'start', B: 'blue', R: 'red', E: 'event' };

export const SPACES: Space[] = [...PATTERN].map((ch, i) => {
  const t = (i / PATTERN.length) * Math.PI * 2;
  return {
    x: Math.round(210 * Math.sin(t) * (1 + 0.16 * Math.sin(3 * t))),
    y: Math.round(-150 * Math.cos(t) * (1 + 0.14 * Math.cos(2 * t))),
    type: TYPES[ch],
  };
});

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
export const LAP_BONUS = 5;
export const MINIGAME_PRIZE = 10;

export function toLngLat(lng0: number, lat0: number, x: number, y: number): [number, number] {
  const lat = lat0 + y / 111320;
  const lng = lng0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180));
  return [lng, lat];
}
