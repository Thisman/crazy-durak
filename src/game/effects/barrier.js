import { SUIT_BY_ID } from '../cards.js';

function suitLabel(suitId) {
  return SUIT_BY_ID[suitId]?.label ?? suitId ?? 'масть';
}

export const barrier = {
  id: 'barrier',
  title: 'Барьер',
  description: 'Когда этой картой покрывают атаку, атакующий может подкидывать только карты этой масти до конца боя.',
  icon: 'fa-solid fa-lock',

  apply(cardModel, zones, context) {
    if (context.role !== 'defense') return null;
    context.state.forcedAttackSuit = cardModel.suit;
    return {
      applied: true,
      message: `атакующий может подкидывать только масть ${suitLabel(cardModel.suit)}`,
      pulseIds: [cardModel.id]
    };
  }
};
