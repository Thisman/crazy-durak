import { allDefended, isSlotDefended, opponentOf } from './rules.js';

export function maxPlayOrder(state) {
  let maxOrder = 0;

  for (const slot of state.battle ?? []) {
    if (Number.isFinite(slot.attackOrder)) maxOrder = Math.max(maxOrder, slot.attackOrder);
    if (Number.isFinite(slot.defenseOrder)) maxOrder = Math.max(maxOrder, slot.defenseOrder);
    for (const order of slot.defenseOrders ?? []) {
      if (Number.isFinite(order)) maxOrder = Math.max(maxOrder, order);
    }
  }

  return maxOrder;
}

export function nextPlayOrder(state) {
  if (!Number.isFinite(state.nextPlayOrder)) {
    state.nextPlayOrder = maxPlayOrder(state) + 1;
  }

  const order = state.nextPlayOrder;
  state.nextPlayOrder += 1;
  return order;
}

export function swapRoles(state) {
  const nextAttacker = state.defender;
  state.defender = state.attacker;
  state.attacker = nextAttacker;
}

export function startNextBattle(state, attacker) {
  state.battleNumber += 1;
  state.attacker = attacker;
  state.defender = opponentOf(attacker);
  state.defenderStartHandCount = state.hands[state.defender].length;
  state.blockedThrowRanks = [];
  state.forbiddenDefenseSuits = [];
  state.forcedAttackSuit = null;
  state.effectPulseIds = [];
}

export function shouldAiAct(state) {
  if (state.phase !== 'playing') return false;
  if (state.attacker === 'ai' && state.battle.length === 0) return true;
  if (state.defender === 'ai' && state.battle.some((slot) => !isSlotDefended(slot))) return true;
  if (state.attacker === 'ai' && state.battle.length > 0 && allDefended(state.battle)) return true;
  return false;
}
