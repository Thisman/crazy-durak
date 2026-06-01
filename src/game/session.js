import { createDeck, shuffle, sortCards } from './cards.js';
import { assignRandomEffects, EFFECT_IDS, getCardEffectId, getCardEffectPayload } from './effects.js';
import { HAND_TARGET, opponentOf, slotDefenses } from './rules.js';

export function cloneCard(card) {
  if (!card) return null;
  return {
    ...card,
    effect: typeof card.effect === 'object' && card.effect ? { ...card.effect } : card.effect
  };
}

export function cloneBattle(battle = []) {
  return battle.map((slot) => {
    const defenses = Array.isArray(slot.defenses)
      ? slot.defenses.map(cloneCard)
      : (slot.defense ? [cloneCard(slot.defense)] : []);
    const defensePositions = Array.isArray(slot.defensePositions)
      ? slot.defensePositions.map((position) => (position ? { ...position } : null))
      : (slot.defensePosition ? [{ ...slot.defensePosition }] : []);
    const defenseSources = Array.isArray(slot.defenseSources)
      ? [...slot.defenseSources]
      : defenses.map(() => null);

    return {
      attack: cloneCard(slot.attack),
      defense: defenses.at(-1) ?? null,
      defenses,
      attackPosition: slot.attackPosition ? { ...slot.attackPosition } : null,
      defensePosition: defensePositions.at(-1) ?? null,
      defensePositions,
      defenseSources,
      attackOrder: Number.isFinite(slot.attackOrder) ? slot.attackOrder : null,
      defenseOrder: Number.isFinite(slot.defenseOrder) ? slot.defenseOrder : null,
      defenseOrders: Array.isArray(slot.defenseOrders)
        ? slot.defenseOrders.map((order) => (Number.isFinite(order) ? order : null))
        : (Number.isFinite(slot.defenseOrder) ? [slot.defenseOrder] : []),
      defensePixelOffsets: Array.isArray(slot.defensePixelOffsets)
        ? slot.defensePixelOffsets.map((offset) => (offset ? { ...offset } : null))
        : [],
      defenseRotations: Array.isArray(slot.defenseRotations)
        ? [...slot.defenseRotations]
        : [],
      requiredDefenseCount: slot.requiredDefenseCount ?? 1,
      source: slot.source ?? null,
      rustyAttack: Boolean(slot.rustyAttack),
      transferBlocked: Boolean(slot.transferBlocked),
      returnAttackTo: slot.returnAttackTo ?? null,
      returnAttackReason: slot.returnAttackReason ?? null
    };
  });
}

export function createEmptyState() {
  return {
    phase: 'idle',
    winner: null,
    deck: [],
    trumpSuit: null,
    trumpCard: null,
    hands: { player: [], ai: [] },
    battle: [],
    discardPile: [],
    discardCount: 0,
    attacker: 'player',
    defender: 'ai',
    defenderStartHandCount: HAND_TARGET,
    battleNumber: 1,
    nextPlayOrder: 1,
    blockedThrowRanks: [],
    forbiddenDefenseSuits: [],
    forcedAttackSuit: null,
    effectPulseIds: [],
    lastEvent: 'Нажмите «Начать игру».',
    eventLog: []
  };
}

export function recordEvent(state, message, options = {}) {
  state.lastEvent = message;
  state.eventLog = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      battleNumber: state.battleNumber,
      kind: options.kind ?? null,
      message
    },
    ...(state.eventLog ?? [])
  ].slice(0, 80);
}

export function cloneState(state) {
  return {
    ...state,
    deck: state.deck.map(cloneCard),
    trumpCard: cloneCard(state.trumpCard),
    nextPlayOrder: Number.isFinite(state.nextPlayOrder) ? state.nextPlayOrder : null,
    hands: {
      player: state.hands.player.map(cloneCard),
      ai: state.hands.ai.map(cloneCard)
    },
    battle: cloneBattle(state.battle),
    discardPile: (state.discardPile ?? []).map(cloneCard),
    blockedThrowRanks: [...(state.blockedThrowRanks ?? [])],
    forbiddenDefenseSuits: [...(state.forbiddenDefenseSuits ?? [])],
    forcedAttackSuit: state.forcedAttackSuit ?? null,
    effectPulseIds: [...(state.effectPulseIds ?? [])],
    eventLog: [...(state.eventLog ?? [])]
  };
}

export function removeCard(hand, cardId) {
  const index = hand.findIndex((card) => card.id === cardId);
  if (index === -1) return null;
  return hand.splice(index, 1)[0];
}

export function findCard(hand, cardId) {
  return hand.find((card) => card.id === cardId) ?? null;
}

export function drawCard(state, actor) {
  if (state.deck.length === 0) return null;
  const card = state.deck.shift();
  state.hands[actor].push(card);
  return card;
}

export function drawToSix(state, actor) {
  while (state.hands[actor].length < HAND_TARGET && state.deck.length > 0) {
    drawCard(state, actor);
  }
}

function addUnique(items, item) {
  if (item && !items.includes(item)) items.push(item);
}

export function rebuildBattleEffectState(state) {
  state.blockedThrowRanks = [];
  state.forbiddenDefenseSuits = [];
  state.forcedAttackSuit = null;

  for (const slot of state.battle) {
    const attackEffectId = getCardEffectId(slot.attack);

    slot.requiredDefenseCount = attackEffectId === EFFECT_IDS.DOUBLE_COVER ? 2 : 1;
    slot.rustyAttack = attackEffectId === EFFECT_IDS.RUST;
    slot.transferBlocked = attackEffectId === EFFECT_IDS.BLIND_DEFENSE;

    if (attackEffectId === EFFECT_IDS.RANK_LOCK) {
      addUnique(state.blockedThrowRanks, slot.attack.rank);
    }

    if (attackEffectId === EFFECT_IDS.FORBID_SUIT) {
      addUnique(state.forbiddenDefenseSuits, getCardEffectPayload(slot.attack).suit);
    }

    for (const defense of slotDefenses(slot)) {
      if (getCardEffectId(defense) === EFFECT_IDS.BARRIER) {
        state.forcedAttackSuit = defense.suit;
      }
    }
  }
}

function lowestTrumpOwner(hands, trumpSuit) {
  const playerTrump = sortCards(hands.player.filter((card) => card.suit === trumpSuit), trumpSuit)[0];
  const aiTrump = sortCards(hands.ai.filter((card) => card.suit === trumpSuit), trumpSuit)[0];

  if (!playerTrump && !aiTrump) return 'player';
  if (playerTrump && !aiTrump) return 'player';
  if (!playerTrump && aiTrump) return 'ai';
  return playerTrump.value <= aiTrump.value ? 'player' : 'ai';
}

export function setupState(seed, rng) {
  const deck = shuffle(assignRandomEffects(createDeck(), rng), rng);
  const state = createEmptyState();

  state.deck = deck.slice(HAND_TARGET * 2);
  state.hands.player = deck.slice(0, HAND_TARGET);
  state.hands.ai = deck.slice(HAND_TARGET, HAND_TARGET * 2);
  state.trumpCard = state.deck[state.deck.length - 1] ?? null;
  state.trumpSuit = state.trumpCard?.suit ?? null;

  if (state.trumpSuit) {
    for (const card of [...state.hands.player, ...state.hands.ai, ...state.deck]) {
      if (card.suit === state.trumpSuit && getCardEffectId(card) === EFFECT_IDS.SPEAR) {
        delete card.effect;
      }
    }
  }

  state.attacker = lowestTrumpOwner(state.hands, state.trumpSuit);
  state.defender = opponentOf(state.attacker);
  state.defenderStartHandCount = state.hands[state.defender].length;
  state.phase = 'playing';
  recordEvent(state, state.attacker === 'player'
    ? 'Вы ходите первым.'
    : 'ИИ ходит первым.');

  return state;
}
