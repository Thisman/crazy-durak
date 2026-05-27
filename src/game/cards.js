export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUITS = [
  { id: 'clubs', symbol: '♣', color: 'black', label: 'трефы' },
  { id: 'diamonds', symbol: '♦', color: 'red', label: 'бубны' },
  { id: 'hearts', symbol: '♥', color: 'red', label: 'червы' },
  { id: 'spades', symbol: '♠', color: 'black', label: 'пики' }
];

export const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index + 2]));
export const SUIT_BY_ID = Object.fromEntries(SUITS.map((suit) => [suit.id, suit]));

export function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank}-${suit.id}`,
      rank,
      value: RANK_VALUE[rank],
      suit: suit.id,
      symbol: suit.symbol,
      color: suit.color,
      label: `${rank} ${suit.label}`
    }))
  );
}

export function createRng(seed = String(Date.now())) {
  let h = 1779033703 ^ String(seed).length;

  for (let i = 0; i < String(seed).length; i += 1) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function shuffle(cards, rng = Math.random) {
  const result = [...cards];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

export function sortCards(cards, trumpSuit) {
  return [...cards].sort((a, b) => {
    const trumpDelta = Number(a.suit === trumpSuit) - Number(b.suit === trumpSuit);
    if (trumpDelta !== 0) return trumpDelta;
    if (a.value !== b.value) return a.value - b.value;
    return a.suit.localeCompare(b.suit);
  });
}

export function cardLabel(card) {
  return `${card.rank}${card.symbol}`;
}
