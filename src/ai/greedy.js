import { sortCards } from '../game/cards.js';
import { allDefended, canThrowIn, firstUndefendedSlot, isTrump, tableRanks } from '../game/rules.js';
import { canCardBeatAttack, canCardTransfer } from '../game/card-model.js';

function cardCost(card, trumpSuit) {
  return card.value + (isTrump(card, trumpSuit) ? 20 : 0);
}

function byCost(trumpSuit) {
  return (a, b) => cardCost(a, trumpSuit) - cardCost(b, trumpSuit);
}

function chooseAttackAction(view) {
  const card = sortCards(view.hand, view.trumpSuit)[0] ?? null;
  return card ? { type: 'attack', cardId: card.id } : null;
}

function chooseDefenseAction(view) {
  const slot = firstUndefendedSlot(view.battle);
  if (!slot) return null;

  const card = sortCards(view.hand, view.trumpSuit)
    .filter((c) => canCardBeatAttack(c, slot.attack, view))
    .sort(byCost(view.trumpSuit))[0] ?? null;

  return card ? { type: 'defense', cardId: card.id, targetCardId: slot.attack.id } : null;
}

function chooseTransferAction(view) {
  const slot = firstUndefendedSlot(view.battle);
  if (!slot) return null;

  const transferCard = sortCards(view.hand, view.trumpSuit)
    .filter((c) => canCardTransfer(c, view, 'ai'))
    .sort(byCost(view.trumpSuit))[0] ?? null;

  if (!transferCard) return null;

  const defenseAction = chooseDefenseAction(view);
  if (defenseAction) {
    const defenseCard = view.hand.find((c) => c.id === defenseAction.cardId);
    if (defenseCard && cardCost(transferCard, view.trumpSuit) > cardCost(defenseCard, view.trumpSuit)) {
      return null;
    }
  }

  return { type: 'transfer', cardId: transferCard.id };
}

function chooseThrowInAction(view) {
  const ranks = tableRanks(view.battle);

  const card = sortCards(view.hand, view.trumpSuit)
    .filter((c) => ranks.has(c.rank) && canThrowIn(view, 'ai', c))
    .sort(byCost(view.trumpSuit))[0] ?? null;

  return card ? { type: 'throw-in', cardId: card.id } : null;
}

/**
 * Greedy AI — picks the cheapest legal card at each decision point.
 * @type {import('./interface.js').AIStrategy}
 */
export const greedyAI = {
  id: 'greedy',
  label: 'Жадный ИИ',

  chooseAction(view) {
    if (view.phase !== 'playing') return null;

    if (view.attacker === 'ai' && view.battle.length === 0) {
      return chooseAttackAction(view);
    }

    if (view.defender === 'ai') {
      const transfer = chooseTransferAction(view);
      if (transfer) return transfer;

      const slot = firstUndefendedSlot(view.battle);
      if (!slot) return null;

      const defense = chooseDefenseAction(view);
      if (defense) return defense;

      return { type: 'take' };
    }

    if (view.attacker === 'ai' && allDefended(view.battle)) {
      const throwIn = chooseThrowInAction(view);
      return throwIn ?? { type: 'finish' };
    }

    return null;
  },

  chooseThrowWhileTaking(view) {
    return chooseThrowInAction(view);
  }
};
