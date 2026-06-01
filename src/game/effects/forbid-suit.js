import { SUIT_BY_ID, SUITS } from '../cards.js';

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

function suitLabel(suitId) {
  return SUIT_BY_ID[suitId]?.label ?? suitId ?? 'масть';
}

function effectPayload(cardModel) {
  return typeof cardModel.effect === 'object' && cardModel.effect ? cardModel.effect : {};
}

export const forbidSuit = {
  id: 'forbid_suit',
  title: 'Запрет масти',
  description: 'Защитник не может крыть выбранной мастью до конца боя.',
  icon: 'fa-solid fa-suitcase',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike) return null;
    const suit = effectPayload(cardModel).suit;
    if (!suit) return null;
    context.state.forbiddenDefenseSuits ??= [];
    if (!context.state.forbiddenDefenseSuits.includes(suit)) {
      context.state.forbiddenDefenseSuits.push(suit);
    }
    return {
      applied: true,
      message: `защитник не может крыть мастью ${suitLabel(suit)}`,
      pulseIds: [cardModel.id]
    };
  },

  createPayload(rng, card) {
    const suits = SUITS.filter((suit) => suit.id !== card?.suit);
    return { suit: randomItem(suits.length ? suits : SUITS, rng).id };
  },

  describePayload(card) {
    const payload = effectPayload(card);
    return payload.suit
      ? `Защитник не может крыть мастью: ${suitLabel(payload.suit)}.`
      : null;
  }
};
