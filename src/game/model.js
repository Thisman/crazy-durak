import { battleCards, opponentOf } from './rules.js';
export {
  CARD_STATES,
  canCardBeatAttack,
  canCardTransfer,
  createCardModel,
  getCardDropTargets
} from './card-model.js';

function cloneCard(card) {
  return card ? { ...card } : null;
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
