import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/game/cards.js';
import { createGameFromState } from '../src/game/game.js';
import { createCardModel, createFieldModel } from '../src/game/model.js';
import { MAX_THROW_INS, canBeat } from '../src/game/rules.js';
import { EFFECT_DEFINITIONS, EFFECT_IDS, assignRandomEffects } from '../src/game/effects.js';

function card(id, rank, suit, value) {
  const symbols = { hearts: '♥', spades: '♠', clubs: '♣', diamonds: '♦' };
  const colors = { hearts: 'red', diamonds: 'red', clubs: 'black', spades: 'black' };
  const rankValues = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };

  return {
    id,
    rank,
    value: value ?? rankValues[rank],
    suit,
    symbol: symbols[suit],
    color: colors[suit],
    label: `${rank} ${suit}`
  };
}

function state(overrides = {}) {
  return {
    phase: 'playing',
    winner: null,
    deck: [],
    trumpSuit: 'spades',
    trumpCard: card('trump', '2', 'spades'),
    hands: { player: [], ai: [] },
    battle: [],
    discardPile: [],
    discardCount: 0,
    attacker: 'player',
    defender: 'ai',
    defenderStartHandCount: 6,
    battleNumber: 2,
    lastEvent: '',
    ...overrides,
    hands: {
      player: overrides.hands?.player ?? [],
      ai: overrides.hands?.ai ?? []
    },
    discardPile: overrides.discardPile ?? []
  };
}

function gameFrom(customState) {
  return createGameFromState(customState, { autoAdvanceAi: false });
}

test('creates a unique 52-card deck without jokers', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((item) => item.id)).size, 52);
  assert.equal(deck.some((item) => item.rank.toLowerCase().includes('joker')), false);
});

test('compares defense cards with and without trump', () => {
  assert.equal(canBeat(card('8h', '8', 'hearts'), card('9h', '9', 'hearts'), 'spades'), true);
  assert.equal(canBeat(card('8h', '8', 'hearts'), card('7h', '7', 'hearts'), 'spades'), false);
  assert.equal(canBeat(card('ah', 'A', 'hearts'), card('2s', '2', 'spades'), 'spades'), true);
  assert.equal(canBeat(card('as', 'A', 'spades'), card('2h', '2', 'hearts'), 'spades'), false);
});

test('defends a specific attack card', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [defense], ai: [] },
    battle: [{ attack, defense: null, attackOrder: 3 }],
    defenderStartHandCount: 1,
    nextPlayOrder: 4
  }));

  const result = game.playDefense(attack.id, defense.id);
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].defense.id, defense.id);
  assert.deepEqual(result.state.battle[0].defenseSources, ['player']);
  assert.deepEqual(result.state.battle[0].defenseOrders, [4]);
  assert.equal(result.state.battle[0].defenseOrder > result.state.battle[0].attackOrder, true);
});

test('uses table drop as the first valid defense when transfer is unavailable', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [defense], ai: [] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1
  }));

  const result = game.playCardToTargetAt(defense.id, 'table', { x: 0.25, y: 0.66 });
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].defense.id, defense.id);
  assert.deepEqual(result.state.battle[0].defensePosition, { x: 0.535, y: 0.5 });
});

test('uses pointer position for direct attack-card defense drops', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [defense], ai: [] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1
  }));

  const result = game.playCardToTargetAt(defense.id, `attack-card:${attack.id}`, { x: 0.25, y: 0.66 });
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].defense.id, defense.id);
  assert.deepEqual(result.state.battle[0].defensePosition, { x: 0.25, y: 0.66 });
});

test('uses table drop for transfer and attack-card drop for trump defense', () => {
  const attack = card('attack-7h', '7', 'hearts');
  const transferOrDefense = card('defense-7s', '7', 'spades');

  const transferGame = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transferOrDefense], ai: [card('ai-x', 'A', 'clubs'), card('ai-y', 'K', 'clubs')] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1,
    battleNumber: 2
  }));

  assert.deepEqual(transferGame.getPublicState().legalTargets[transferOrDefense.id].sort(), [
    `attack-card:${attack.id}`,
    'table'
  ].sort());

  const transferResult = transferGame.playCardToTarget(transferOrDefense.id, 'table');
  assert.equal(transferResult.ok, true);
  assert.equal(transferResult.state.attacker, 'player');
  assert.equal(transferResult.state.battle.length, 2);

  const defenseGame = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transferOrDefense], ai: [card('ai-x', 'A', 'clubs'), card('ai-y', 'K', 'clubs')] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1,
    battleNumber: 2
  }));

  const defenseResult = defenseGame.playCardToTarget(transferOrDefense.id, `attack-card:${attack.id}`);
  assert.equal(defenseResult.ok, true);
  assert.equal(defenseResult.state.battle[0].defense.id, transferOrDefense.id);
});

test('blocks transfer during the first battle but allows field-drop defense fallback', () => {
  const attack = card('attack-7h', '7', 'hearts');
  const transfer = card('transfer-7s', '7', 'spades');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transfer], ai: [card('ai-x', 'A', 'clubs'), card('ai-y', 'K', 'clubs')] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1,
    battleNumber: 1
  }));

  const result = game.playCardToTarget(transfer.id, 'table');
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].defense.id, transfer.id);
  assert.equal(result.state.battle.length, 1);
});

test('allows transfer from the second battle', () => {
  const attack = card('attack-7h', '7', 'hearts');
  const transfer = card('transfer-7c', '7', 'clubs');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transfer], ai: [card('ai-x', 'A', 'clubs'), card('ai-y', 'K', 'clubs')] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 1,
    battleNumber: 2
  }));

  assert.equal(game.playCardToTarget(transfer.id, 'table').ok, true);
});

test('stores player drop position for attack cards', () => {
  const attack = card('attack-5h', '5', 'hearts');
  const game = gameFrom(state({
    hands: { player: [attack], ai: [card('ai-1', 'A', 'clubs')] },
    battle: []
  }));

  const result = game.playCardToTargetAt(attack.id, 'table', { x: 0.72, y: 0.18 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.battle[0].attackPosition, { x: 0.72, y: 0.18 });
});

test('shifts a new active attack away from an overlapping active attack', () => {
  const firstAttack = card('attack-9h', '9', 'hearts');
  const secondAttack = card('attack-9s', '9', 'spades');
  const game = gameFrom(state({
    attacker: 'player',
    defender: 'ai',
    hands: { player: [secondAttack], ai: Array.from({ length: 6 }, (_, index) => card(`ai-${index}`, 'A', 'clubs')) },
    battle: [{
      attack: firstAttack,
      defense: null,
      attackPosition: { x: 0.5, y: 0.5 },
      attackOrder: 1
    }],
    defenderStartHandCount: 6,
    nextPlayOrder: 2
  }));

  const result = game.throwIn(secondAttack.id, { x: 0.5, y: 0.5 });
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[1].attackPosition.y, 0.5);
  assert.notEqual(result.state.battle[1].attackPosition.x, 0.5);
  assert.equal(Math.abs(result.state.battle[1].attackPosition.x - result.state.battle[0].attackPosition.x) >= 0.14, true);
  assert.equal(result.state.battle[1].attackOrder, 2);
});

test('does not shift transfer cards even when dropped over an active attack', () => {
  const attack = card('attack-7h', '7', 'hearts');
  const transfer = card('transfer-7c', '7', 'clubs');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transfer], ai: [card('ai-x', 'A', 'clubs'), card('ai-y', 'K', 'clubs')] },
    battle: [{ attack, defense: null, attackPosition: { x: 0.5, y: 0.5 }, attackOrder: 1 }],
    defenderStartHandCount: 1,
    battleNumber: 2,
    nextPlayOrder: 2
  }));

  const result = game.playCardToTargetAt(transfer.id, 'table', { x: 0.5, y: 0.5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.battle[1].attackPosition, { x: 0.5, y: 0.5 });
});

test('card model exposes validity from cards currently in play', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const playable = card('playable-10h', '10', 'hearts');
  const dead = card('dead-2c', '2', 'clubs');
  const customState = state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [playable, dead], ai: [] },
    battle: [{ attack, defense: null }],
    defenderStartHandCount: 2
  });
  const field = createFieldModel(customState, 'player');

  assert.equal(createCardModel(playable, customState, 'player').isValid(field.fieldCards), true);
  assert.equal(createCardModel(dead, customState, 'player').isValid(field.fieldCards), false);
  assert.equal(Array.isArray(field.discardCards), true);
  assert.equal(Array.isArray(field.deckCards), true);
  assert.equal(Array.isArray(field.enemyCards), true);
  assert.equal(Array.isArray(field.playerCards), true);
});

test('limits throw-ins to five cards after the first attack', () => {
  const extra = card('extra-9s', '9', 'spades');
  const battle = Array.from({ length: MAX_THROW_INS + 1 }, (_, index) => ({
    attack: card(`attack-${index}`, '9', index % 2 ? 'hearts' : 'clubs'),
    defense: card(`defense-${index}`, '10', index % 2 ? 'hearts' : 'clubs')
  }));
  const game = gameFrom(state({
    hands: { player: [extra], ai: Array.from({ length: 10 }, (_, index) => card(`ai-${index}`, 'A', 'clubs')) },
    battle,
    defenderStartHandCount: 10
  }));

  assert.equal(game.throwIn(extra.id).ok, false);
});

test('blocks throw-ins beyond defender starting hand size', () => {
  const extra = card('extra-9s', '9', 'spades');
  const battle = [
    { attack: card('attack-1', '9', 'hearts'), defense: card('defense-1', '10', 'hearts') },
    { attack: card('attack-2', '10', 'clubs'), defense: card('defense-2', 'J', 'clubs') }
  ];
  const game = gameFrom(state({
    hands: { player: [extra], ai: [card('ai-1', 'A', 'clubs')] },
    battle,
    defenderStartHandCount: 2
  }));

  assert.equal(game.throwIn(extra.id).ok, false);
});

test('draws cards to six after a finished battle', () => {
  const game = gameFrom(state({
    deck: [
      card('draw-p-1', '2', 'clubs'),
      card('draw-p-2', '3', 'clubs'),
      card('draw-ai-1', '4', 'clubs'),
      card('draw-ai-2', '5', 'clubs')
    ],
    hands: {
      player: [card('player-a', 'A', 'hearts'), card('player-k', 'K', 'hearts'), card('player-q', 'Q', 'hearts'), card('player-j', 'J', 'hearts')],
      ai: [card('ai-a', 'A', 'spades'), card('ai-k', 'K', 'spades'), card('ai-q', 'Q', 'spades'), card('ai-j', 'J', 'spades')]
    },
    battle: [{ attack: card('attack', '6', 'clubs'), defense: card('defense', '7', 'clubs') }]
  }));

  const result = game.finishBattle();
  assert.equal(result.ok, true);
  assert.equal(result.state.playerCardCount, 6);
  assert.equal(result.state.aiCardCount, 6);
});

test('finishes the game when deck is empty and a hand is empty', () => {
  const game = gameFrom(state({
    deck: [],
    hands: { player: [], ai: [card('ai-left', 'A', 'clubs')] },
    battle: [{ attack: card('attack', '6', 'clubs'), defense: card('defense', '7', 'clubs') }]
  }));

  const result = game.finishBattle();
  assert.equal(result.ok, true);
  assert.equal(result.state.phase, 'finished');
  assert.equal(result.state.winner, 'player');
});

test('randomly assigns at most one effect per card and can leave cards plain', () => {
  const values = [0, 1];
  const cards = assignRandomEffects(
    [card('plain-a', '2', 'clubs'), card('plain-b', '3', 'clubs')],
    () => values.shift() ?? 1,
    0.5
  );

  assert.equal(cards[0].effect, EFFECT_IDS.DOUBLE_COVER);
  assert.equal(cards[1].effect, undefined);
  assert.deepEqual(EFFECT_DEFINITIONS.map((effect) => effect.id), [EFFECT_IDS.DOUBLE_COVER]);
});

test('double-cover attack requires two defense cards', () => {
  const attack = { ...card('attack-6h', '6', 'hearts'), effect: EFFECT_IDS.DOUBLE_COVER };
  const firstDefense = card('defense-7h', '7', 'hearts');
  const secondDefense = card('defense-8h', '8', 'hearts');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [firstDefense, secondDefense], ai: [] },
    battle: [{ attack, defense: null, defenses: [], requiredDefenseCount: 2 }],
    defenderStartHandCount: 2
  }));

  const first = game.playDefense(attack.id, firstDefense.id);
  assert.equal(first.ok, true);
  assert.equal(first.state.battle[0].defenses.length, 1);
  assert.equal(first.state.battle[0].isDefended, false);

  const second = game.playDefense(attack.id, secondDefense.id);
  assert.equal(second.ok, true);
  assert.equal(second.state.battle[0].defenses.length, 2);
  assert.equal(second.state.battle[0].isDefended, true);
  assert.equal(second.state.battle[0].defenseOrders[1] > second.state.battle[0].defenseOrders[0], true);
});

test('double-cover effect is applied when the attack card is played', () => {
  const attack = { ...card('attack-6h', '6', 'hearts'), effect: EFFECT_IDS.DOUBLE_COVER };
  const game = gameFrom(state({
    hands: { player: [attack], ai: [card('ai-a', 'A', 'clubs'), card('ai-k', 'K', 'clubs')] },
    battle: []
  }));

  const result = game.playAttack(attack.id);
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].requiredDefenseCount, 2);
  assert.equal(result.state.canFinish, false);
});

test('AI covers a double-cover attack twice before the battle is defended', () => {
  const attack = { ...card('attack-6c', '6', 'clubs'), effect: EFFECT_IDS.DOUBLE_COVER };
  const firstDefense = card('ai-defense-7c', '7', 'clubs');
  const secondDefense = card('ai-defense-8c', '8', 'clubs');
  const game = gameFrom(state({
    attacker: 'player',
    defender: 'ai',
    hands: { player: [attack], ai: [firstDefense, secondDefense] },
    battle: [],
    defenderStartHandCount: 2
  }));

  const attackResult = game.playAttack(attack.id);
  assert.equal(attackResult.ok, true);
  assert.equal(attackResult.state.battle[0].requiredDefenseCount, 2);

  const firstDefenseResult = game.advanceOpponent();
  assert.equal(firstDefenseResult.ok, true);
  assert.equal(firstDefenseResult.state.battle[0].defenses.length, 1);
  assert.equal(firstDefenseResult.state.battle[0].isDefended, false);

  const secondDefenseResult = game.advanceOpponent();
  assert.equal(secondDefenseResult.ok, true);
  assert.equal(secondDefenseResult.state.battle[0].defenses.length, 2);
  assert.equal(secondDefenseResult.state.battle[0].isDefended, true);
});
