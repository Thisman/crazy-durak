import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameFromState } from '../../src/game/game.js';
import {
  EFFECT_IDS,
  applyCardEffect,
  getCardEffectDescription,
  getCardEffectId,
  hasEffect,
  registerEffect
} from '../../src/game/effects.js';
import { createFieldModel } from '../../src/game/model.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function card(id, rank, suit, extra = {}) {
  const symbols = { hearts: '♥', spades: '♠', clubs: '♣', diamonds: '♦' };
  const rankValues = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
  return {
    id,
    rank,
    value: rankValues[rank] ?? 2,
    suit,
    symbol: symbols[suit],
    color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black',
    label: `${rank} ${suit}`,
    ...extra
  };
}

function slot(attack, defense = null, extra = {}) {
  return {
    attack,
    defense,
    defenses: defense ? [defense] : [],
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
    returnAttackReason: null,
    ...extra
  };
}

function baseState(overrides = {}) {
  return {
    phase: 'playing',
    winner: null,
    deck: [],
    trumpSuit: 'spades',
    trumpCard: null,
    hands: { player: [], ai: [] },
    battle: [],
    discardPile: [],
    discardCount: 0,
    attacker: 'player',
    defender: 'ai',
    defenderStartHandCount: 6,
    battleNumber: 2,
    nextPlayOrder: 1,
    blockedThrowRanks: [],
    forbiddenDefenseSuits: [],
    forcedAttackSuit: null,
    effectPulseIds: [],
    lastEvent: '',
    eventLog: [],
    ...overrides
  };
}

function applyContext(cardModel, gameState, extra = {}) {
  return {
    card: cardModel,
    state: gameState,
    actor: 'player',
    enemy: 'ai',
    random: Math.random,
    role: 'attack',
    isAttackLike: true,
    playedCard: cardModel,
    ...extra
  };
}

// ─── EFFECT_IDS ───────────────────────────────────────────────────────────────

test('EFFECT_IDS contains all expected effect identifiers', () => {
  const expected = [
    'DOUBLE_COVER', 'RANK_LOCK', 'RUST', 'RANK_UP', 'BLIND_DEFENSE', 'BOUNCE',
    'FORBID_SUIT', 'SPEAR', 'BARRIER', 'CLONE', 'BLACK_MARK', 'HAND_SWAP', 'NULLIFY_EFFECT'
  ];
  for (const key of expected) {
    assert.ok(EFFECT_IDS[key], `EFFECT_IDS.${key} should be defined`);
  }
});

// ─── double_cover ─────────────────────────────────────────────────────────────

test('double-cover: sets requiredDefenseCount to 2 on the attack slot', () => {
  const attackCard = card('a1', '7', 'hearts', { effect: EFFECT_IDS.DOUBLE_COVER });
  const gameState = baseState();
  const attackSlot = slot(attackCard);
  gameState.battle.push(attackSlot);

  const outcome = applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    slot: attackSlot,
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(outcome.applied, true);
  assert.equal(attackSlot.requiredDefenseCount, 2);
});

test('double-cover: does nothing when played as defense', () => {
  const defenseCard = card('d1', '8', 'hearts', { effect: EFFECT_IDS.DOUBLE_COVER });
  const gameState = baseState();
  const attackSlot = slot(card('a1', '7', 'hearts'));

  const outcome = applyCardEffect(defenseCard, null, applyContext(defenseCard, gameState, {
    slot: attackSlot,
    role: 'defense',
    isAttackLike: false
  }));

  assert.equal(outcome, null);
  assert.equal(attackSlot.requiredDefenseCount, 1);
});

// ─── rank_lock ────────────────────────────────────────────────────────────────

test('rank-lock: adds card rank to blockedThrowRanks when played as attack', () => {
  const attackCard = card('a1', 'J', 'clubs', { effect: EFFECT_IDS.RANK_LOCK });
  const gameState = baseState();

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.ok(gameState.blockedThrowRanks.includes('J'));
});

test('rank-lock: does not add duplicate ranks to blockedThrowRanks', () => {
  const attackCard = card('a1', 'J', 'clubs', { effect: EFFECT_IDS.RANK_LOCK });
  const gameState = baseState({ blockedThrowRanks: ['J'] });

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(gameState.blockedThrowRanks.filter((r) => r === 'J').length, 1);
});

// ─── rust ─────────────────────────────────────────────────────────────────────

test('rust: marks the attack slot as rusty', () => {
  const attackCard = card('a1', '6', 'hearts', { effect: EFFECT_IDS.RUST });
  const gameState = baseState();
  const attackSlot = slot(attackCard);

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    slot: attackSlot,
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(attackSlot.rustyAttack, true);
});

// ─── blind_defense ────────────────────────────────────────────────────────────

test('blind-defense: marks the attack slot as transfer-blocked', () => {
  const attackCard = card('a1', '9', 'clubs', { effect: EFFECT_IDS.BLIND_DEFENSE });
  const gameState = baseState();
  const attackSlot = slot(attackCard);

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    slot: attackSlot,
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(attackSlot.transferBlocked, true);
});

// ─── bounce ───────────────────────────────────────────────────────────────────

test('bounce: sets returnAttackTo on the covered slot when played as defense', () => {
  const attackCard = card('a1', '8', 'hearts', { source: 'ai' });
  const defenseCard = card('d1', '9', 'hearts', { effect: EFFECT_IDS.BOUNCE });
  const attackSlot = slot(attackCard, null, { source: 'ai' });
  const gameState = baseState({ attacker: 'ai', defender: 'player' });

  applyCardEffect(defenseCard, null, applyContext(defenseCard, gameState, {
    role: 'defense',
    isAttackLike: false,
    coveredSlot: attackSlot,
    coveredCard: attackCard,
    actor: 'player',
    enemy: 'ai'
  }));

  assert.equal(attackSlot.returnAttackTo, 'ai');
});

// ─── forbid_suit ──────────────────────────────────────────────────────────────

test('forbid-suit: adds the forbidden suit to state.forbiddenDefenseSuits', () => {
  const attackCard = card('a1', '7', 'clubs', {
    effect: { id: EFFECT_IDS.FORBID_SUIT, suit: 'hearts' }
  });
  const gameState = baseState();

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.ok(gameState.forbiddenDefenseSuits.includes('hearts'));
});

test('forbid-suit: describePayload returns suit-specific description', () => {
  const c = card('a1', '7', 'clubs', { effect: { id: EFFECT_IDS.FORBID_SUIT, suit: 'hearts' } });
  const description = getCardEffectDescription(c);
  // SUIT_BY_ID['hearts'].label === 'червы'
  assert.ok(description?.includes('♥') || description?.toLowerCase().includes('червы'));
});

// ─── barrier ─────────────────────────────────────────────────────────────────

test('barrier: sets forcedAttackSuit when played as defense', () => {
  const defenseCard = card('d1', '9', 'diamonds', { effect: EFFECT_IDS.BARRIER });
  const gameState = baseState();
  const attackSlot = slot(card('a1', '8', 'clubs'));

  applyCardEffect(defenseCard, null, applyContext(defenseCard, gameState, {
    role: 'defense',
    isAttackLike: false,
    slot: attackSlot,
    coveredSlot: attackSlot
  }));

  assert.equal(gameState.forcedAttackSuit, 'diamonds');
});

test('barrier: does nothing when played as attack', () => {
  const attackCard = card('a1', '9', 'diamonds', { effect: EFFECT_IDS.BARRIER });
  const gameState = baseState();

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(gameState.forcedAttackSuit, null);
});

// ─── clone ────────────────────────────────────────────────────────────────────

test('clone: spawns the top deck card when played in attack', () => {
  const attackCard = card('a1', '7', 'clubs', { effect: EFFECT_IDS.CLONE });
  const deckCard = card('deck1', '5', 'hearts');
  const gameState = baseState({ deck: [deckCard] });

  const outcome = applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(outcome.applied, true);
  assert.equal(outcome.spawnedCard.id, 'deck1');
  assert.equal(gameState.deck.length, 0);
});

test('clone: does nothing when deck is empty', () => {
  const attackCard = card('a1', '7', 'clubs', { effect: EFFECT_IDS.CLONE });
  const gameState = baseState({ deck: [] });

  const outcome = applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(outcome.applied, false);
});

// ─── hand_swap ────────────────────────────────────────────────────────────────

test('hand-swap: exchanges player and AI hands', () => {
  const playerCard = card('p1', '7', 'hearts');
  const aiCard = card('ai1', 'K', 'spades');
  const attackCard = card('a1', '8', 'clubs', { effect: EFFECT_IDS.HAND_SWAP });
  const gameState = baseState({
    hands: { player: [playerCard], ai: [aiCard] }
  });

  applyCardEffect(attackCard, null, applyContext(attackCard, gameState, {
    role: 'attack',
    isAttackLike: true
  }));

  assert.equal(gameState.hands.player[0].id, 'ai1');
  assert.equal(gameState.hands.ai[0].id, 'p1');
});

// ─── registerEffect (extensibility) ──────────────────────────────────────────

test('registerEffect: custom effects can be registered and applied', () => {
  const applied = [];

  registerEffect({
    id: 'test_custom_effect',
    title: 'Тестовый эффект',
    description: 'Только для тестов.',
    icon: 'fa-test',
    apply(cardModel, zones, context) {
      applied.push(cardModel.id);
      return { applied: true, message: 'тест', pulseIds: [cardModel.id] };
    }
  });

  const c = card('x1', '5', 'clubs', { effect: 'test_custom_effect' });
  const outcome = applyCardEffect(c, null, applyContext(c, baseState()));
  assert.equal(outcome.applied, true);
  assert.ok(applied.includes('x1'));
  // EFFECT_IDS is Proxy-backed — newly registered effects are immediately accessible
  assert.equal(EFFECT_IDS['TEST_CUSTOM_EFFECT'], 'test_custom_effect');
});

// ─── hasEffect / getCardEffectId ──────────────────────────────────────────────

test('hasEffect: works with string and object effect payloads', () => {
  const c1 = card('c1', '7', 'clubs', { effect: EFFECT_IDS.RUST });
  const c2 = card('c2', '7', 'clubs', { effect: { id: EFFECT_IDS.FORBID_SUIT, suit: 'hearts' } });
  const c3 = card('c3', '7', 'clubs');

  assert.equal(hasEffect(c1, EFFECT_IDS.RUST), true);
  assert.equal(hasEffect(c2, EFFECT_IDS.FORBID_SUIT), true);
  assert.equal(hasEffect(c3, EFFECT_IDS.RUST), false);
  assert.equal(getCardEffectId(c1), EFFECT_IDS.RUST);
  assert.equal(getCardEffectId(c2), EFFECT_IDS.FORBID_SUIT);
  assert.equal(getCardEffectId(c3), null);
});
