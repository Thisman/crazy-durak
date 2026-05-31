import {
  canBeat,
  canStartAttack,
  canThrowIn,
  canTransfer,
  battleCards,
  isSlotDefended,
  opponentOf,
  tableRanks
} from './rules.js';
import {
  applyCardEffect,
  getCardEffect,
  getCardEffectId
} from './effects.js';

function cloneCard(card) {
  return card ? { ...card } : null;
}

function normalizeCards(cards) {
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

export function createFieldModel(state, actor = 'player', options = {}) {
  const enemy = opponentOf(actor);
  const cards = (items) => (options.mutable ? items : items.map(cloneCard));

  return {
    discardCards: cards(state.discardPile ?? []),
    deckCards: cards(state.deck),
    enemyCards: cards(state.hands[enemy]),
    playerCards: cards(state.hands[actor]),
    humanCards: cards(state.hands.player),
    aiCards: cards(state.hands.ai),
    fieldCards: cards(battleCards(state.battle)),
    apply(cardModel, context) {
      return cardModel?.apply?.(this, context) ?? null;
    }
  };
}

export function canCardBeatAttack(defenseCard, attackCard, state) {
  if (!defenseCard || !attackCard) return false;
  return canBeat(attackCard, defenseCard, state.trumpSuit);
}

export function canCardTransfer(card, state, actor) {
  return canTransfer(state, actor, card);
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

  if (canCardTransfer(card, state, actor)) {
    targets.push('table');
  }

  if (state.defender === actor) {
    const defenseTargets = state.battle
      .filter((slot) => !isSlotDefended(slot) && canCardBeatAttack(card, slot.attack, state))
      .map((slot) => `attack-card:${slot.attack.id}`);

    targets.push(...defenseTargets);

    if (defenseTargets.length > 0 && !targets.includes('table')) {
      targets.push('table');
    }
  }

  return [...new Set(targets)];
}

export function createCardModel(card, state, actor = 'player') {
  const effect = getCardEffect(card);
  const effectId = getCardEffectId(card);

  return {
    ...cloneCard(card),
    nominal: card?.rank ?? null,
    rank: card?.rank ?? null,
    suit: card?.suit ?? null,
    effectId,
    effectTitle: effect?.title ?? null,
    effectDescription: effect?.description ?? null,
    effectIcon: effect?.icon ?? null,
    isValid(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay).length > 0;
    },
    getDropTargets(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay);
    },
    apply(zones, context = {}) {
      return applyCardEffect(this, zones, context);
    }
  };
}
