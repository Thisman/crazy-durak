import { EFFECT_IDS, hasEffect } from './effects.js';

export const MAX_THROW_INS = 5;
export const HAND_TARGET = 6;

export function opponentOf(actor) {
  return actor === 'player' ? 'ai' : 'player';
}

export function canBeat(attackCard, defenseCard, trumpSuit) {
  if (!attackCard || !defenseCard) return false;

  if (attackCard.suit === defenseCard.suit) {
    return defenseCard.value > attackCard.value;
  }

  return defenseCard.suit === trumpSuit && attackCard.suit !== trumpSuit;
}

export function isTrump(card, trumpSuit) {
  return card.suit === trumpSuit;
}

export function slotDefenses(slot) {
  if (!slot) return [];
  if (Array.isArray(slot.defenses)) return slot.defenses.filter(Boolean);
  return slot.defense ? [slot.defense] : [];
}

export function slotDefenseCount(slot) {
  return slotDefenses(slot).length;
}

export function requiredDefenseCount(slot) {
  return Math.max(1, Number(slot?.requiredDefenseCount) || 1);
}

export function isSlotDefended(slot) {
  return slotDefenseCount(slot) >= requiredDefenseCount(slot);
}

export function tableRanks(battle) {
  const ranks = new Set();

  for (const slot of battle) {
    ranks.add(slot.attack.rank);
    for (const defense of slotDefenses(slot)) {
      ranks.add(defense.rank);
    }
  }

  return ranks;
}

export function allDefended(battle) {
  return battle.length > 0 && battle.every((slot) => isSlotDefended(slot));
}

export function firstUndefendedSlot(battle) {
  return battle.find((slot) => !isSlotDefended(slot)) ?? null;
}

export function battleCards(battle) {
  return battle.flatMap((slot) => [slot.attack, ...slotDefenses(slot)]);
}

function hasTransferBlock(state) {
  return state.battle.some((slot) => slot.transferBlocked || hasEffect(slot.attack, EFFECT_IDS.BLIND_DEFENSE));
}

export function canStartAttack(state, actor) {
  return state.phase === 'playing' && state.attacker === actor && state.battle.length === 0;
}

export function canThrowIn(state, actor, card) {
  if (state.phase !== 'playing') return false;
  if (state.attacker !== actor) return false;
  if (state.battle.length === 0) return false;
  if ((state.blockedThrowRanks ?? []).includes(card.rank)) return false;
  if (!tableRanks(state.battle).has(card.rank)) return false;
  if (state.battle.length - 1 >= MAX_THROW_INS) return false;
  if (state.battle.length >= state.defenderStartHandCount) return false;
  return true;
}

export function canFinishBattle(state, actor) {
  return state.phase === 'playing' && state.attacker === actor && allDefended(state.battle);
}

export function canTransfer(state, actor, card) {
  if (state.phase !== 'playing') return false;
  if (state.defender !== actor) return false;
  if (state.battleNumber <= 1) return false;
  if (state.battle.length === 0) return false;
  if (state.battle.some((slot) => slotDefenseCount(slot) > 0)) return false;
  if (hasTransferBlock(state)) return false;

  const rank = state.battle[0].attack.rank;
  if (card.rank !== rank) return false;
  if (!state.battle.every((slot) => slot.attack.rank === rank)) return false;

  const newDefender = state.attacker;
  if (state.hands[newDefender].length < state.battle.length + 1) return false;
  if (state.battle.length - 1 >= MAX_THROW_INS) return false;

  return true;
}

export function getDropTargetsForCard(state, actor, card) {
  return getLegacyDropTargets(state, actor, card);
}

function getLegacyDropTargets(state, actor, card) {
  if (!card || state.phase !== 'playing') return [];

  const targets = [];

  if (canStartAttack(state, actor) || canThrowIn(state, actor, card) || canTransfer(state, actor, card)) {
    targets.push('table');
  }

  if (state.defender === actor) {
    for (const slot of state.battle) {
      if (
        !isSlotDefended(slot)
        && !(state.forbiddenDefenseSuits ?? []).includes(card.suit)
        && canBeat(slot.attack, card, state.trumpSuit)
      ) {
        targets.push(`attack-card:${slot.attack.id}`);
      }
    }
  }

  return targets;
}
