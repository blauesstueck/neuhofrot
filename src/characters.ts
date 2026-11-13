export interface Character {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

// Platzhalter-Avatare als Emoji – später einfach durch Bilder ersetzbar.
export const CHARACTERS: Character[] = [
  { id: 'tralalero', name: 'Tralalero Tralala', emoji: '🦈', color: '#3b82f6' },
  { id: 'tungtung', name: 'Tung Tung Tung Sahur', emoji: '🪵', color: '#b45309' },
  { id: 'bombardiro', name: 'Bombardiro Crocodilo', emoji: '🐊', color: '#16a34a' },
  { id: 'ballerina', name: 'Ballerina Cappuccina', emoji: '☕', color: '#ec4899' },
  { id: 'patapim', name: 'Brr Brr Patapim', emoji: '🐒', color: '#65a30d' },
  { id: 'lirili', name: 'Lirilì Larilà', emoji: '🐘', color: '#d97706' },
  { id: 'assassino', name: 'Cappuccino Assassino', emoji: '🥷', color: '#7c3aed' },
  { id: 'bananini', name: 'Chimpanzini Bananini', emoji: '🍌', color: '#eab308' },
];
