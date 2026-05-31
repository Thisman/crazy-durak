import { sortCards } from './cards.js';
import { canThrowIn, firstUndefendedSlot, isTrump, tableRanks } from './rules.js';
import { canCardBeatAttack, canCardTransfer } from './model.js';

function cardCost(card, trumpSuit) {
  return card.value + (isTrump(card, trumpSuit) ? 20 : 0);
}

function playableCards(hand) {
  return hand;
}

export function chooseAttackCard(hand, trumpSuit, state = null) {
  return sortCards(playableCards(hand, state), trumpSuit)[0] ?? null;
}

export function chooseDefenseCard(hand, attackCard, trumpSuit, state = null) {
  const ruleState = state ?? { trumpSuit };

  return sortCards(playableCards(hand, state), trumpSuit)
    .filter((card) => canCardBeatAttack(card, attackCard, ruleState))
    .sort((a, b) => cardCost(a, trumpSuit) - cardCost(b, trumpSuit))[0] ?? null;
}

export function chooseThrowInCard(hand, state, actor) {
  const ranks = tableRanks(state.battle);

  return sortCards(playableCards(hand, state), state.trumpSuit)
    .filter((card) => ranks.has(card.rank))
    .filter((card) => canThrowIn(state, actor, card))
    .sort((a, b) => cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit))[0] ?? null;
}

export function chooseTransferCard(hand, state, actor) {
  const slot = firstUndefendedSlot(state.battle);
  if (!slot) return null;

  const defense = chooseDefenseCard(hand, slot.attack, state.trumpSuit, state);
  const transferCards = sortCards(playableCards(hand, state), state.trumpSuit)
    .filter((card) => canCardTransfer(card, state, actor))
    .sort((a, b) => cardCost(a, state.trumpSuit) - cardCost(b, state.trumpSuit));

  const transfer = transferCards[0] ?? null;
  if (!transfer) return null;
  if (!defense) return transfer;

  return cardCost(transfer, state.trumpSuit) <= cardCost(defense, state.trumpSuit) ? transfer : null;
}

export function shouldTransfer(state, actor, card) {
  return canCardTransfer(card, state, actor);
}
