import test from 'node:test';
import assert from 'node:assert/strict';
import { greedyAI } from '../../src/ai/greedy.js';
import { EFFECT_IDS } from '../../src/game/effects.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function card(id, rank, suit, value, extra = {}) {
  const symbols = { hearts: '♥', spades: '♠', clubs: '♣', diamonds: '♦' };
  const rankValues = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
  return {
    id,
    rank,
    value: value ?? rankValues[rank] ?? 2,
    suit,
    symbol: symbols[suit],
    color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black',
    label: `${rank} ${suit}`,
    ...extra
  };
}

function slot(attack, defense = null, extra = {}) {
  const defenses = defense ? [defense] : [];
  return {
    attack,
    defense,
    defenses,
    defensePositions: [],
    defenseSources: [],
    defenseOrders: [],
    attackPosition: { x: 0.5, y: 0.5 },
    defensePosition: null,
    attackOrder: 1,
    defenseOrder: null,
    requiredDefenseCount: 1,
    source: 'player',
    rustyAttack: false,
    transferBlocked: false,
    returnAttackTo: null,
    ...extra
  };
}

function view(overrides = {}) {
  return {
    hand: [],
    trumpSuit: 'spades',
    battle: [],
    attacker: 'ai',
    defender: 'player',
    phase: 'playing',
    blockedThrowRanks: [],
    forbiddenDefenseSuits: [],
    forcedAttackSuit: null,
    defenderStartHandCount: 6,
    battleNumber: 2,
    hands: { player: Array.from({ length: 6 }, (_, i) => card(`p${i}`, '7', 'hearts')), ai: [] },
    deckCount: 10,
    ...overrides
  };
}

// ─── chooseAction: attack ─────────────────────────────────────────────────────

test('chooseAction: AI as attacker with empty battle → attack action', () => {
  const aiCard = card('ai1', '7', 'hearts');
  const v = view({ hand: [aiCard], attacker: 'ai', defender: 'player', battle: [] });
  const action = greedyAI.chooseAction(v);

  assert.equal(action?.type, 'attack');
  assert.equal(action?.cardId, 'ai1');
});

test('chooseAction: no hand cards → null (no attack)', () => {
  const v = view({ hand: [], attacker: 'ai', defender: 'player', battle: [] });
  const action = greedyAI.chooseAction(v);
  assert.equal(action, null);
});

test('chooseAction: AI not attacker and no battle → null', () => {
  const v = view({ hand: [card('ai1', '7', 'hearts')], attacker: 'player', defender: 'ai', battle: [] });
  const action = greedyAI.chooseAction(v);
  assert.equal(action, null);
});

test('chooseAction: AI chooses cheapest non-trump attack card', () => {
  const cheap = card('c1', '6', 'hearts');
  const expensive = card('c2', 'A', 'hearts');
  const trumpCard = card('c3', '2', 'spades');
  const v = view({ hand: [expensive, cheap, trumpCard], attacker: 'ai', defender: 'player', battle: [] });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.cardId, 'c1');
});

// ─── chooseAction: defense ────────────────────────────────────────────────────

test('chooseAction: AI as defender → defense action against undefended slot', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const defenseCard = card('def1', '8', 'hearts');
  const v = view({
    hand: [defenseCard],
    attacker: 'player',
    defender: 'ai',
    battle: [slot(attackCard)],
    hands: { player: [], ai: [defenseCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'defense');
  assert.equal(action?.cardId, 'def1');
  assert.equal(action?.targetCardId, 'atk1');
});

test('chooseAction: AI cannot defend → take action', () => {
  const attackCard = card('atk1', 'A', 'hearts');
  const weakCard = card('def1', '2', 'clubs');
  const v = view({
    hand: [weakCard],
    attacker: 'player',
    defender: 'ai',
    battle: [slot(attackCard)],
    hands: { player: [], ai: [weakCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'take');
});

test('chooseAction: AI prefers cheaper defense card', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const cheap = card('def1', '8', 'hearts');
  const expensive = card('def2', 'A', 'hearts');
  const v = view({
    hand: [expensive, cheap],
    attacker: 'player',
    defender: 'ai',
    battle: [slot(attackCard)],
    hands: { player: [], ai: [expensive, cheap] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.cardId, 'def1');
});

test('chooseAction: AI can defend with trump if only option', () => {
  const attackCard = card('atk1', 'A', 'hearts');
  const trumpCard = card('t1', '2', 'spades');
  const v = view({
    hand: [trumpCard],
    trumpSuit: 'spades',
    attacker: 'player',
    defender: 'ai',
    battle: [slot(attackCard)],
    hands: { player: [], ai: [trumpCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'defense');
  assert.equal(action?.cardId, 't1');
});

// ─── chooseAction: throw-in / finish ─────────────────────────────────────────

test('chooseAction: AI as attacker with all defended → throw-in if matching rank', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const defenseCard = card('def1', '8', 'hearts');
  const throwCard = card('ai1', '7', 'clubs');
  const battleSlot = slot(attackCard, defenseCard);

  const v = view({
    hand: [throwCard],
    attacker: 'ai',
    defender: 'player',
    battle: [battleSlot],
    defenderStartHandCount: 6,
    hands: { player: Array.from({ length: 6 }, (_, i) => card(`p${i}`, '9', 'clubs')), ai: [throwCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'throw-in');
  assert.equal(action?.cardId, 'ai1');
});

test('chooseAction: AI as attacker with all defended and no matching rank → finish', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const defenseCard = card('def1', '8', 'hearts');
  const nonMatchCard = card('ai1', '9', 'clubs');
  const battleSlot = slot(attackCard, defenseCard);

  const v = view({
    hand: [nonMatchCard],
    attacker: 'ai',
    defender: 'player',
    battle: [battleSlot],
    defenderStartHandCount: 6,
    hands: { player: Array.from({ length: 6 }, (_, i) => card(`p${i}`, '5', 'clubs')), ai: [nonMatchCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'finish');
});

// ─── chooseAction: transfer ───────────────────────────────────────────────────

test('chooseAction: AI transfers when cheaper than defending', () => {
  const attackCard = card('atk1', 'A', 'hearts');
  const transferCard = card('ai1', 'A', 'clubs');
  // Player (new defender after transfer) has enough cards
  const playerHand = Array.from({ length: 6 }, (_, i) => card(`p${i}`, '5', 'clubs'));

  const v = view({
    hand: [transferCard],
    attacker: 'player',
    defender: 'ai',
    trumpSuit: 'spades',
    battle: [slot(attackCard)],
    battleNumber: 2,
    defenderStartHandCount: 6,
    hands: { player: playerHand, ai: [transferCard] }
  });

  const action = greedyAI.chooseAction(v);
  assert.equal(action?.type, 'transfer');
  assert.equal(action?.cardId, 'ai1');
});

// ─── chooseAction: non-playing phases ─────────────────────────────────────────

test('chooseAction: returns null when phase is not playing', () => {
  const v = view({ phase: 'idle' });
  assert.equal(greedyAI.chooseAction(v), null);

  const v2 = view({ phase: 'finished' });
  assert.equal(greedyAI.chooseAction(v2), null);
});

// ─── chooseThrowWhileTaking ───────────────────────────────────────────────────

test('chooseThrowWhileTaking: returns throw-in when matching rank exists', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const defenseCard = card('def1', '8', 'hearts');
  const throwCard = card('ai1', '7', 'clubs');
  const battleSlot = slot(attackCard, defenseCard);

  // AI is attacker; player (defender) decided to take — AI can still throw in
  const v = view({
    hand: [throwCard],
    attacker: 'ai',
    defender: 'player',
    battle: [battleSlot],
    defenderStartHandCount: 6,
    hands: { player: Array.from({ length: 6 }, (_, i) => card(`p${i}`, '9', 'clubs')), ai: [throwCard] }
  });

  const action = greedyAI.chooseThrowWhileTaking(v);
  assert.equal(action?.type, 'throw-in');
  assert.equal(action?.cardId, 'ai1');
});

test('chooseThrowWhileTaking: returns null when no matching rank', () => {
  const attackCard = card('atk1', '7', 'hearts');
  const defenseCard = card('def1', '8', 'hearts');
  const aiCard = card('ai1', 'K', 'clubs');
  const battleSlot = slot(attackCard, defenseCard);

  const v = view({
    hand: [aiCard],
    attacker: 'player',
    defender: 'ai',
    battle: [battleSlot],
    defenderStartHandCount: 6,
    hands: { player: [], ai: [aiCard] }
  });

  const action = greedyAI.chooseThrowWhileTaking(v);
  assert.equal(action, null);
});
