import { SUIT_BY_ID } from '../cards.js';

export const trumpChange = {
  id: 'trump_change',
  title: 'Знамя',
  description: 'При атаке меняет козырную масть на масть этой карты.',
  icon: 'fa-solid fa-flag',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike) return null;
    const { state } = context;
    const newSuit = cardModel.suit;
    if (!newSuit || state.trumpSuit === newSuit) return { applied: false };

    const suitInfo = SUIT_BY_ID[newSuit];
    state.trumpSuit = newSuit;

    if (state.trumpCard && state.deck.length > 0) {
      state.trumpCard.suit = newSuit;
      state.trumpCard.symbol = suitInfo.symbol;
      state.trumpCard.color = suitInfo.color;
    }

    return {
      applied: true,
      message: `масть козыря изменилась на ${suitInfo.label}`,
      pulseIds: [cardModel.id]
    };
  }
};
