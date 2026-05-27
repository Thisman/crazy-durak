import {
  canBeat,
  canStartAttack,
  canThrowIn,
  canTransfer,
  battleCards,
  opponentOf,
  tableRanks
} from './rules.js';

function cloneCard(card) {
  return card ? { ...card } : null;
}

function normalizeCards(cards) {
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

export function createFieldModel(state, actor = 'player') {
  const enemy = opponentOf(actor);

  return {
    discardCards: (state.discardPile ?? []).map(cloneCard),
    deckCards: state.deck.map(cloneCard),
    enemyCards: state.hands[enemy].map(cloneCard),
    playerCards: state.hands[actor].map(cloneCard),
    fieldCards: battleCards(state.battle).map(cloneCard),
    apply() {}
  };
}

export function getCardDropTargets(card, state, actor, cardsInPlay = battleCards(state.battle)) {
  if (!card || state.phase !== 'playing') return [];

  const normalizedCardsInPlay = normalizeCards(cardsInPlay);
  const ranksInPlay = normalizedCardsInPlay.length
    ? new Set(normalizedCardsInPlay.map((item) => item.rank))
    : tableRanks(state.battle);
  const targets = [];

  if (canStartAttack(state, actor)) {
    targets.push('table');
  }

  if (state.attacker === actor && state.battle.length > 0) {
    if (
      ranksInPlay.has(card.rank)
      && canThrowIn(state, actor, card)
    ) {
      targets.push('table');
    }
  }

  if (canTransfer(state, actor, card)) {
    targets.push('table');
  }

  if (state.defender === actor) {
    const defenseTargets = state.battle
      .filter((slot) => !slot.defense && canBeat(slot.attack, card, state.trumpSuit))
      .map((slot) => `attack-card:${slot.attack.id}`);

    targets.push(...defenseTargets);

    if (defenseTargets.length > 0 && !targets.includes('table')) {
      targets.push('table');
    }
  }

  return [...new Set(targets)];
}

export function createCardModel(card, state, actor = 'player') {
  return {
    ...cloneCard(card),
    nominal: card?.rank ?? null,
    rank: card?.rank ?? null,
    suit: card?.suit ?? null,
    isValid(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay).length > 0;
    },
    getDropTargets(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay);
    },
    apply() {}
  };
}
