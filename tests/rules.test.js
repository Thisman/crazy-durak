import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/game/cards.js';
import { createGameFromState } from '../src/game/game.js';
import { CARD_STATES, canCardBeatAttack, createCardModel, createFieldModel } from '../src/game/model.js';
import { MAX_THROW_INS, canBeat } from '../src/game/rules.js';
import { EFFECT_DEFINITIONS, EFFECT_IDS, assignRandomEffects, createEffect } from '../src/game/effects.js';
import { getDragGroup, getSlotZModel, moveTableGroup } from '../src/game/table-model.js';
import {
  TRANSITION_TYPES,
  createBattleClearTransition,
  createCardActionTransitions,
  normalizeTransitions
} from '../src/game/transitions.js';

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

test('keeps overlapping throw-in drop position instead of forcing a shift', () => {
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
  assert.deepEqual(result.state.battle[1].attackPosition, { x: 0.5, y: 0.5 });
  assert.equal(result.state.battle[1].attackOrder, 2);
});

test('keeps transfer drop position instead of forcing a shift', () => {
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

test('keeps throw-in position when dropped over defended cards', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const throwCard = card('throw-10c', '10', 'clubs');
  const game = gameFrom(state({
    attacker: 'player',
    defender: 'ai',
    hands: { player: [throwCard], ai: Array.from({ length: 6 }, (_, index) => card(`ai-${index}`, 'A', 'clubs')) },
    battle: [{
      attack,
      defense,
      defenses: [defense],
      attackPosition: { x: 0.5, y: 0.5 },
      defensePosition: { x: 0.54, y: 0.58 },
      defensePositions: [{ x: 0.54, y: 0.58 }],
      attackOrder: 1,
      defenseOrder: 2,
      defenseOrders: [2]
    }],
    defenderStartHandCount: 6,
    nextPlayOrder: 3
  }));

  const result = game.throwIn(throwCard.id, { x: 0.54, y: 0.58 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.battle[1].attackPosition, { x: 0.54, y: 0.58 });
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

test('card model exposes hand, played, and beaten states with lifecycle hooks', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const playable = card('playable-10s', '10', 'spades');
  const dead = card('dead-2c', '2', 'clubs');
  const aiHand = card('ai-hand', 'A', 'clubs');
  const handState = state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [playable, dead], ai: [aiHand] },
    battle: [{ attack, defense: null, defenses: [], source: 'ai' }],
    defenderStartHandCount: 2
  });
  const tableState = state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [], ai: [aiHand] },
    battle: [{ attack, defense, defenses: [defense], source: 'ai', defenseSources: ['player'] }],
    defenderStartHandCount: 2
  });

  const playableModel = createCardModel(playable, handState, 'player');
  const deadModel = createCardModel(dead, handState, 'player');
  const aiHandModel = createCardModel(aiHand, handState, 'player');
  const attackModel = createCardModel(attack, tableState, 'player');
  const defenseModel = createCardModel(defense, tableState, 'player');

  assert.equal(playableModel.state, CARD_STATES.VALID);
  assert.equal(deadModel.state, CARD_STATES.INVALID);
  assert.equal(aiHandModel.state, CARD_STATES.IN_HAND);
  assert.equal(attackModel.state, CARD_STATES.BEATEN);
  assert.equal(defenseModel.state, CARD_STATES.PLAYED);
  assert.equal(playableModel.canDrag(), true);
  assert.equal(typeof playableModel.onHoverStart, 'function');
  assert.equal(playableModel.onPlayCommit().lifecycle, 'play');
});

test('table model centralizes z-order and beaten stack drag groups', () => {
  const beatenAttack = card('beaten-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const liveAttack = card('live-9c', '9', 'clubs');
  const battle = [
    {
      attack: beatenAttack,
      defense,
      defenses: [defense],
      attackOrder: 1,
      defenseOrder: 2,
      defenseOrders: [2],
      requiredDefenseCount: 1
    },
    {
      attack: liveAttack,
      defense: null,
      defenses: [],
      attackOrder: 3
    }
  ];

  const beatenZ = getSlotZModel(battle[0], 0);
  const liveZ = getSlotZModel(battle[1], 1);
  const group = getDragGroup(battle[0]);

  assert.equal(beatenZ.defenseZIndexes[0] > beatenZ.attackZIndex, true);
  assert.equal(liveZ.attackZIndex > beatenZ.defenseZIndexes[0], true);
  assert.deepEqual(group.cardIds, [beatenAttack.id, defense.id]);
});

test('table group movement preserves defense offset inside the stack', () => {
  const attack = card('attack-9h', '9', 'hearts');
  const defense = card('defense-10h', '10', 'hearts');
  const customState = state({
    battle: [{
      attack,
      defense,
      defenses: [defense],
      attackPosition: { x: 0.4, y: 0.4 },
      defensePosition: { x: 0.46, y: 0.52 },
      defensePositions: [{ x: 0.46, y: 0.52 }],
      requiredDefenseCount: 1
    }]
  });

  const moved = moveTableGroup(customState, `slot:${attack.id}`, { x: 0.6, y: 0.5 });

  assert.equal(moved.groupId, `slot:${attack.id}`);
  assert.deepEqual(customState.battle[0].attackPosition, { x: 0.6, y: 0.5 });
  assert.equal(Math.abs(customState.battle[0].defensePosition.x - 0.66) < 1e-9, true);
  assert.equal(Math.abs(customState.battle[0].defensePosition.y - 0.62) < 1e-9, true);
});

test('transitions expose explicit lifecycle order without event text parsing', () => {
  const cardTransitions = createCardActionTransitions('card-1', 'defense', { actor: 'player' });
  const clearTransitions = createBattleClearTransition('discard', null, ['card-1']);
  const transitions = normalizeTransitions([cardTransitions, clearTransitions]);

  assert.deepEqual(transitions.map((item) => item.type), [
    TRANSITION_TYPES.HOVER_END,
    TRANSITION_TYPES.CARD_BEAT,
    TRANSITION_TYPES.CARD_DISCARD,
    TRANSITION_TYPES.BATTLE_CLEAR
  ]);
  assert.equal(transitions.some((item) => Object.hasOwn(item, 'lastEvent')), false);
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
  assert.deepEqual(EFFECT_DEFINITIONS.map((effect) => effect.id), Object.values(EFFECT_IDS));
});

test('rank-lock effect blocks same-rank throw-ins', () => {
  const lock = { ...card('lock-7h', '7', 'hearts'), effect: EFFECT_IDS.RANK_LOCK };
  const sameRank = card('same-7c', '7', 'clubs');
  const game = gameFrom(state({
    hands: { player: [lock, sameRank], ai: Array.from({ length: 6 }, (_, index) => card(`ai-${index}`, 'A', 'clubs')) },
    battle: []
  }));

  const attack = game.playAttack(lock.id);
  assert.equal(attack.ok, true);
  assert.equal(attack.state.legalTargets[sameRank.id].includes('table'), false);
  assert.equal(game.throwIn(sameRank.id).ok, false);
});

test('rank-up effect promotes the played card without changing its id', () => {
  const flip = { ...card('flip-6h', '6', 'hearts'), effect: EFFECT_IDS.RANK_UP };
  const game = gameFrom(state({
    hands: { player: [flip], ai: [card('ai-a', 'A', 'clubs')] },
    battle: []
  }));

  const result = game.playAttack(flip.id);
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].attack.id, flip.id);
  assert.equal(result.state.battle[0].attack.value > 6, true);
  assert.equal(result.state.battle[0].attack.value <= 14, true);
  assert.equal(result.state.battle[0].attack.nominal, result.state.battle[0].attack.rank);
});

test('blind-defense effect blocks transfer', () => {
  const blind = { ...card('blind-7h', '7', 'hearts'), effect: EFFECT_IDS.BLIND_DEFENSE };
  const transfer = card('transfer-7c', '7', 'clubs');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [transfer], ai: [blind] },
    battle: [],
    battleNumber: 2,
    defenderStartHandCount: 1
  }));

  const attack = game.advanceOpponent();
  assert.equal(attack.ok, true);
  assert.equal(attack.state.battle[0].transferBlocked, true);
  assert.equal(attack.state.legalTargets[transfer.id].includes('table'), false);
  assert.equal(game.playCardToTarget(transfer.id, 'table').ok, false);
});

test('forbid-suit effect blocks the selected defense suit and shows it in tooltip data', () => {
  const forbid = { ...card('forbid-6c', '6', 'clubs'), effect: { id: EFFECT_IDS.FORBID_SUIT, suit: 'hearts' } };
  const attack = card('attack-7h', '7', 'hearts');
  const heartDefense = card('defense-8h', '8', 'hearts');
  const customState = state({
    forbiddenDefenseSuits: ['hearts'],
    battle: [{ attack, defense: null }]
  });

  const model = createCardModel(forbid, customState, 'player');
  assert.equal(model.effectDescription.includes('черв'), true);
  assert.equal(canCardBeatAttack(heartDefense, attack, customState), false);
});

test('forbid-suit assignment excludes the card suit', () => {
  const effect = createEffect(EFFECT_IDS.FORBID_SUIT, () => 0, card('forbid-6c', '6', 'clubs'));

  assert.equal(effect.id, EFFECT_IDS.FORBID_SUIT);
  assert.notEqual(effect.suit, 'clubs');
  assert.equal(['diamonds', 'hearts', 'spades'].includes(effect.suit), true);
});

test('nullifier defense cancels the beaten attack effect and active state', () => {
  const attack = { ...card('attack-6h', '6', 'hearts'), effect: EFFECT_IDS.DOUBLE_COVER };
  const nullifier = { ...card('nullifier-7h', '7', 'hearts'), effect: EFFECT_IDS.NULLIFY_EFFECT };
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [nullifier], ai: [] },
    battle: [{ attack, defense: null, defenses: [], requiredDefenseCount: 2, source: 'ai' }],
    defenderStartHandCount: 1
  }));

  const result = game.playDefense(attack.id, nullifier.id);
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].attack.effectId, null);
  assert.equal(result.state.battle[0].requiredDefenseCount, 1);
  assert.equal(result.state.battle[0].isDefended, true);
  assert.equal(result.state.eventLog[0].kind, 'effect');
});

test('nullifier attack cancels the covering card effect before it applies', () => {
  const attack = { ...card('attack-6h', '6', 'hearts'), effect: EFFECT_IDS.NULLIFY_EFFECT };
  const bounce = { ...card('bounce-7h', '7', 'hearts'), effect: EFFECT_IDS.BOUNCE };
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [bounce], ai: [] },
    battle: [{ attack, defense: null, defenses: [], source: 'ai' }],
    defenderStartHandCount: 1
  }));

  const result = game.playDefense(attack.id, bounce.id);
  assert.equal(result.ok, true);
  assert.equal(result.state.battle[0].defense.effectId, null);
  assert.equal(result.state.battle[0].returnAttackTo, null);
  assert.equal(result.state.eventLog[0].kind, 'effect');
});

test('bounce returns the beaten attack to its source when the defender takes', () => {
  const firstAttack = card('attack-6h', '6', 'hearts');
  const secondAttack = card('attack-9c', '9', 'clubs');
  const bounceDefense = { ...card('bounce-7h', '7', 'hearts'), effect: EFFECT_IDS.BOUNCE };
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    hands: { player: [bounceDefense], ai: [] },
    battle: [
      { attack: firstAttack, defense: null, defenses: [], source: 'ai' },
      { attack: secondAttack, defense: null, defenses: [], source: 'ai' }
    ],
    defenderStartHandCount: 2
  }));

  assert.equal(game.playDefense(firstAttack.id, bounceDefense.id).ok, true);
  const result = game.takeCards();
  assert.equal(result.ok, true);
  assert.equal(result.state.aiCardCount, 1);
  assert.equal(result.state.playerCardCount, 2);
  assert.equal(game.state.hands.ai[0].id, firstAttack.id);
});

test('bounce returns the beaten attack to its source when the battle finishes', () => {
  const attack = card('attack-6h', '6', 'hearts');
  const bounceDefense = { ...card('bounce-7h', '7', 'hearts'), effect: EFFECT_IDS.BOUNCE };
  const game = gameFrom(state({
    attacker: 'player',
    defender: 'ai',
    hands: {
      player: Array.from({ length: 6 }, (_, index) => card(`player-${index}`, 'A', 'clubs')),
      ai: []
    },
    battle: [{
      attack,
      defense: bounceDefense,
      defenses: [bounceDefense],
      source: 'ai',
      returnAttackTo: 'ai'
    }],
    defenderStartHandCount: 1
  }));

  const result = game.finishBattle();
  assert.equal(result.ok, true);
  assert.equal(game.state.hands.ai.some((item) => item.id === attack.id), true);
  assert.equal(game.state.discardPile.some((item) => item.id === attack.id), false);
  assert.equal(game.state.discardPile.some((item) => item.id === bounceDefense.id), true);
});

test('rust makes the taker draw an extra card for an unbeaten rusty attack', () => {
  const rustyAttack = { ...card('rust-6h', '6', 'hearts'), effect: EFFECT_IDS.RUST };
  const extraDraw = card('draw-2c', '2', 'clubs');
  const game = gameFrom(state({
    attacker: 'ai',
    defender: 'player',
    deck: [extraDraw],
    hands: { player: [], ai: [] },
    battle: [{ attack: rustyAttack, defense: null, defenses: [], rustyAttack: true, source: 'ai' }],
    defenderStartHandCount: 1
  }));

  const result = game.takeCards();
  assert.equal(result.ok, true);
  assert.equal(result.state.playerCardCount, 2);
  assert.equal(result.state.deckCount, 0);
});


test('black mark reveals marked AI hand cards in public state', () => {
  const marked = { ...card('marked-9s', '9', 'spades'), effect: EFFECT_IDS.BLACK_MARK };
  const hidden = card('hidden-2c', '2', 'clubs');
  const game = gameFrom(state({
    hands: { player: [], ai: [marked, hidden] }
  }));

  const publicState = game.getPublicState();
  assert.equal(publicState.aiHandPreview[0].id, marked.id);
  assert.equal(publicState.aiHandPreview[1], null);
});

test('hand-swap exchanges all remaining hand cards when played', () => {
  const swap = { ...card('swap-6h', '6', 'hearts'), effect: EFFECT_IDS.HAND_SWAP };
  const playerLeft = card('player-left-2c', '2', 'clubs');
  const aiFirst = card('ai-first-9c', '9', 'clubs');
  const aiSecond = card('ai-second-10c', '10', 'clubs');
  const game = gameFrom(state({
    hands: { player: [swap, playerLeft], ai: [aiFirst, aiSecond] },
    battle: []
  }));

  const result = game.playAttack(swap.id);
  assert.equal(result.ok, true);
  assert.deepEqual(game.state.hands.player.map((item) => item.id), [aiFirst.id, aiSecond.id]);
  assert.deepEqual(game.state.hands.ai.map((item) => item.id), [playerLeft.id]);
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
