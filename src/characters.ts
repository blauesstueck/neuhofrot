export interface Character {
  id: string;
  name: string;
  /** Kurzzeichen für Textmeldungen */
  emoji: string;
  color: string;
  /** Gezeichnete Figur als SVG (Brustbild, 100×100) */
  art: string;
}

// Eigene Cartoon-Figuren: flache Farben, dicke dunkle Umrisse, große Kulleraugen.
// Alles ist aus ein paar Bausteinen zusammengesetzt, damit die Figuren zusammenpassen.
const INK = '#1b1035';
const o = (w = 5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const thin = (w = 3.5, color = INK) =>
  `stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" fill="none"`;
const O = o();
const THIN = thin();

const eye = (x: number, y: number, r = 9) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${o(4)}/>` +
  `<circle cx="${x + 1.5}" cy="${y + 1}" r="${r * 0.45}" fill="${INK}"/>` +
  `<circle cx="${x + 3}" cy="${y - 1.5}" r="${r * 0.16}" fill="#fff"/>`;
const eyes = (y: number, gap = 12, r = 9) => eye(50 - gap, y, r) + eye(50 + gap, y, r);
const smile = (y: number, w = 9) => `<path d="M${50 - w} ${y} Q50 ${y + w * 0.9} ${50 + w} ${y}" ${THIN}/>`;
const body = (fill: string) => `<path d="M12 106 Q12 72 50 72 Q88 72 88 106Z" fill="${fill}" ${O}/>`;
const blush = (y: number, gap = 22) =>
  `<circle cx="${50 - gap}" cy="${y}" r="5" fill="#ff7aa8" opacity=".55"/><circle cx="${50 + gap}" cy="${y}" r="5" fill="#ff7aa8" opacity=".55"/>`;
const svg = (inner: string) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

const shark = svg(
  body('#2f6fd6') +
    `<path d="M43 20 L53 1 L63 22Z" fill="#3b82f6" ${O}/>` +
    `<path d="M20 50 Q20 16 50 16 Q80 16 80 50 Q80 82 50 82 Q20 82 20 50Z" fill="#4c9bff" ${O}/>` +
    `<path d="M25 60 Q50 72 75 60 Q72 82 50 82 Q28 82 25 60Z" fill="#eaf4ff"/>` +
    `<path d="M30 60 L37 67 L43 61 L50 69 L57 61 L63 67 L70 60 Q50 84 30 60Z" fill="#fff" ${o(4)}/>` +
    eyes(42),
);

const log = svg(
  body('#8a5a2b') +
    `<path d="M80 100 L90 58" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>` +
    `<path d="M80 100 L90 58" stroke="#e2b877" stroke-width="6" stroke-linecap="round"/>` +
    `<rect x="24" y="16" width="52" height="64" rx="17" fill="#c98a4b" ${O}/>` +
    `<ellipse cx="50" cy="24" rx="26" ry="9" fill="#f3d39b" ${O}/>` +
    `<ellipse cx="50" cy="24" rx="13" ry="4" ${thin(2.5)}/>` +
    `<path d="M30 40 v10 M70 58 v10" ${thin(3)}/>` +
    eyes(50, 11, 8.5) +
    `<path d="M42 66 h16" ${THIN}/>`,
);

const croc = svg(
  body('#12813b') +
    `<circle cx="35" cy="26" r="13" fill="#2fbf5b" ${O}/><circle cx="65" cy="26" r="13" fill="#2fbf5b" ${O}/>` +
    `<path d="M18 50 Q18 30 50 30 Q82 30 82 50 Q82 66 50 66 Q18 66 18 50Z" fill="#2fbf5b" ${O}/>` +
        `<rect x="20" y="52" width="60" height="30" rx="15" fill="#7be08f" ${O}/>` +
    `<circle cx="42" cy="62" r="2.6" fill="${INK}"/><circle cx="58" cy="62" r="2.6" fill="${INK}"/>` +
    `<path d="M32 72 Q50 78 68 72" ${THIN}/>` +
    `<path d="M36 74 l3.5 6 l3.5 -5z M46.5 76 l3.5 6 l3.5 -6z M57 75 l3.5 5 l3.5 -6z" fill="#fff" ${o(3)}/>` +
    eye(35, 27, 8) +
    eye(65, 27, 8),
);

const cup = (cupFill: string) =>
  `<path d="M73 44 Q92 42 89 57 Q86 68 71 63" fill="none" ${O}/>` +
  `<path d="M25 32 L75 32 L68 76 Q50 85 32 76Z" fill="${cupFill}" ${O}/>` +
  `<ellipse cx="50" cy="32" rx="25" ry="8.5" fill="#9a6235" ${O}/>` +
  `<path d="M40 31 q5 -5 10 0 q5 -5 10 0 q-3 6 -10 6 q-7 0 -10 -6z" fill="#f6e3c5"/>`;

const ballerina = svg(
  body('#ec4899') +
    `<path d="M10 96 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 q8 -12 16 0 v10 h-80z" fill="#ffb3d5" ${O}/>` +
    cup('#fff7ee') +
    eyes(54, 10, 7.5) +
    `<path d="M32 47 l-5 -4 M35 45 l-3 -5 M68 47 l5 -4 M65 45 l3 -5" ${thin(3)}/>` +
    blush(63, 19) +
    smile(64, 6),
);

const monkey = svg(
  body('#5a8f12') +
    `<circle cx="21" cy="50" r="11" fill="#a0673a" ${O}/><circle cx="79" cy="50" r="11" fill="#a0673a" ${O}/>` +
    `<circle cx="21" cy="50" r="4.5" fill="#f2c79a"/><circle cx="79" cy="50" r="4.5" fill="#f2c79a"/>` +
    `<circle cx="50" cy="50" r="29" fill="#a0673a" ${O}/>` +
    `<path d="M50 24 Q38 4 26 14 Q38 18 50 24Z M50 24 Q62 4 74 14 Q62 18 50 24Z M50 24 Q44 8 50 0 Q57 8 50 24Z" fill="#7ed321" ${o(4)}/>` +
    `<path d="M30 52 Q30 38 40 38 Q46 38 50 43 Q54 38 60 38 Q70 38 70 52 Q70 72 50 72 Q30 72 30 52Z" fill="#f2c79a"/>` +
    eyes(49, 10, 7.5) +
    `<circle cx="47" cy="59" r="1.6" fill="${INK}"/><circle cx="53" cy="59" r="1.6" fill="${INK}"/>` +
    smile(63, 8),
);

const elephant = svg(
  body('#e8943a') +
    `<ellipse cx="19" cy="44" rx="15" ry="21" fill="#8ea6c2" ${O}/><ellipse cx="81" cy="44" rx="15" ry="21" fill="#8ea6c2" ${O}/>` +
    `<ellipse cx="19" cy="45" rx="7" ry="12" fill="#ffb3c7"/><ellipse cx="81" cy="45" rx="7" ry="12" fill="#ffb3c7"/>` +
    `<circle cx="50" cy="44" r="27" fill="#b3c6dc" ${O}/>` +
    `<path d="M42 52 Q40 82 57 84 Q66 84 65 76 Q57 77 58 52Z" fill="#b3c6dc" ${O}/>` +
    `<path d="M44 64 h12 M45 72 h10" ${thin(2.5)}/>` +
    eyes(40, 12, 7.5) +
    blush(52, 20),
);

const ninja = svg(
  body('#3b1f8f') +
    `<path d="M22 34 L6 6" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M22 34 L6 6" stroke="#cfd8e3" stroke-width="4.500" stroke-linecap="round"/>` +
    `<path d="M71 49 L92 41 L86 52 L93 61 L70 58Z" fill="#2b1a55" ${o(4)}/>` +
    cup('#eadbc6') +
    `<path d="M26.800 43 L73.200 43 L70.300 61 L29.700 61Z" fill="#2b1a55" ${o(4)}/>` +
    `<ellipse cx="40" cy="52" rx="7" ry="5" fill="#fff"/><ellipse cx="60" cy="52" rx="7" ry="5" fill="#fff"/>` +
    `<circle cx="41.500" cy="52.500" r="2.800" fill="${INK}"/><circle cx="58.500" cy="52.500" r="2.800" fill="${INK}"/>` +
    `<path d="M32 46 L46 49 M68 46 L54 49" stroke="#2b1a55" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M44 69 h12" ${THIN}/>`,
);

const banana = svg(
  body('#d9a400') +
    `<path d="M38 12 Q24 42 34 66 Q44 86 62 82 Q78 78 76 58 Q73 32 52 11 Q45 5 38 12Z" fill="#ffd93d" ${O}/>` +
    `<path d="M38 12 Q43 3 51 7 L52 12 Q45 8 38 12Z" fill="#7a4a21" ${o(4)}/>` +
    `<path d="M40 24 Q33 44 40 62" ${thin(3, '#e0a800')}/>` +
    `<ellipse cx="56" cy="54" rx="15" ry="17" fill="#f2c79a"/>` +
    eye(50, 48, 6.5) +
    eye(63, 48, 6.5) +
    `<path d="M49 61 Q56 69 64 61" ${THIN}/>`,
);

export const CHARACTERS: Character[] = [
  { id: 'tralalero', name: 'Tralalero Tralala', emoji: '🦈', color: '#3b82f6', art: shark },
  { id: 'tungtung', name: 'Tung Tung Tung Sahur', emoji: '🪵', color: '#b45309', art: log },
  { id: 'bombardiro', name: 'Bombardiro Crocodilo', emoji: '🐊', color: '#16a34a', art: croc },
  { id: 'ballerina', name: 'Ballerina Cappuccina', emoji: '☕', color: '#ec4899', art: ballerina },
  { id: 'patapim', name: 'Brr Brr Patapim', emoji: '🐒', color: '#65a30d', art: monkey },
  { id: 'lirili', name: 'Lirilì Larilà', emoji: '🐘', color: '#d97706', art: elephant },
  { id: 'assassino', name: 'Cappuccino Assassino', emoji: '🥷', color: '#7c3aed', art: ninja },
  { id: 'bananini', name: 'Chimpanzini Bananini', emoji: '🍌', color: '#eab308', art: banana },
];
