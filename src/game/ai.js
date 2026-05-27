import { sortCards } from './cards.js';
import { canBeat, canThrowIn, canTransfer, firstUndefendedSlot, getDropTargetsForCard, isTrump, tableRanks } from './rules.js';

function cardCost(card, trumpSuit) {
  return card.value + (isTrump(card, trumpSuit) ? 20 : 0);
}

export function chooseAttackCard(hand, trumpSuit) {
  return sortCards(hand, trumpSuit)[0] ?? null;
}

export function chooseDefenseCard(hand, attackCard, trumpSuit) {
  return sortCards(hand, trumpSuit)
    .filter((card) => canBeat(attackCard, card, trumpSuit))
    .sort((a, b) => cardCost(a, trumpSuit) - cardCost(b, trumpSuit))[0] ?? null;
}

export function chooseThrowInCard(hand, state, actor) {
  const ranks = tableRanks(state.battle);

  return sortCards(hand, state.trumpSuit)
    .filter((card) => ranks.has(card.rank))
    .filter((card) => canThrowIn(state, actor, card))
    .sort((a, b) => cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit))[0] ?? null;
}

export function chooseTransferCard(hand, state, actor) {
  const slot = firstUndefendedSlot(state.battle);
  if (!slot) return null;

  const defense = chooseDefenseCard(hand, slot.attack, state.trumpSuit);
  const transferCards = sortCards(hand, state.trumpSuit)
    .filter((card) => getDropTargetsForCard(state, actor, card).includes('table'))
    .sort((a, b) => cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit));

  const transfer = transferCards[0] ?? null;
  if (!transfer) return null;
  if (!defense) return transfer;

  return cardCost(transfer, state.trumpSuit) <= cardCost(defense, state.trumpSuit) ? transfer : null;
}

export function shouldTransfer(state, actor, card) {
  return canTransfer(state, actor, card);
}
