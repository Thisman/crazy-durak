import { isSlotDefended, opponentOf, slotDefenses } from './rules.js';
import { drawCard, drawToSix } from './session.js';
import { createBattleClearTransition } from './transitions.js';
import { startNextBattle } from './turn-order.js';

function cardIdsInBattle(battle) {
  return battle.flatMap((slot) => [
    slot.attack?.id,
    ...slotDefenses(slot).map((card) => card.id)
  ]).filter(Boolean);
}

// ─── Game-over check ───────────────────────────────────────────────────────────

/**
 * Pure game-over check. Returns the outcome or null if game should continue.
 * Does NOT mutate state.
 *
 * @param {object} state
 * @returns {{ phase: string, winner: string, event: string } | null}
 */
export function applyCheckGameOver(state) {
  if (state.phase !== 'playing') return null;
  if (state.battle.length > 0) return null;
  if (state.deck.length > 0) return null;

  const playerDone = state.hands.player.length === 0;
  const aiDone = state.hands.ai.length === 0;

  if (playerDone && aiDone) return { phase: 'finished', winner: 'draw', event: 'Ничья.' };
  if (playerDone) return { phase: 'finished', winner: 'player', event: 'Вы победили.' };
  if (aiDone) return { phase: 'finished', winner: 'ai', event: 'Противник победил.' };
  return null;
}

// ─── Battle resolution ─────────────────────────────────────────────────────────

/**
 * Apply "defender takes all" battle resolution.
 * Mutates state (hands, battle) and returns transitions + event log entries.
 * Caller is responsible for recording events and drawing / starting next battle.
 *
 * @param {object} state   Mutable internal game state
 * @param {'player'|'ai'} defender
 * @returns {{ transitions: Transition[], events: Array<[string, object?]>, attacker: string }}
 */
export function applyResolveTake(state, defender) {
  const attacker = opponentOf(defender);
  const collected = [];
  let bouncedCount = 0;
  let rustDrawCount = 0;
  const transitions = [createBattleClearTransition('take', defender, cardIdsInBattle(state.battle))];

  for (const slot of state.battle) {
    if (slot.returnAttackTo) {
      state.hands[slot.returnAttackTo].push(slot.attack);
      bouncedCount += 1;
    } else {
      collected.push(slot.attack);
    }

    collected.push(...slotDefenses(slot));

    if (slot.rustyAttack && !isSlotDefended(slot)) {
      rustDrawCount += 1;
    }
  }

  state.hands[defender].push(...collected);

  let rustyDrawn = 0;
  for (let index = 0; index < rustDrawCount; index += 1) {
    if (drawCard(state, defender)) rustyDrawn += 1;
  }

  state.battle = [];

  const events = [];
  if (bouncedCount > 0) {
    events.push([`Отскок вернул ${bouncedCount} атакующих карт сопернику.`, { kind: 'effect' }]);
  }
  if (rustyDrawn > 0) {
    events.push([`Ржавчина заставила добрать ${rustyDrawn} карт.`, { kind: 'effect' }]);
  }
  events.push([defender === 'player'
    ? `Вы взяли ${collected.length} карт.`
    : `Противник взял ${collected.length} карт.`]);

  return { transitions, events, attacker };
}

/**
 * Apply "all cards beaten" battle resolution.
 * Mutates state (discardPile, hands, battle) and returns transitions + event log entries.
 * Caller is responsible for recording events and drawing / starting next battle.
 *
 * @param {object} state   Mutable internal game state
 * @returns {{ transitions: Transition[], events: Array<[string, object?]>, attacker: string, defender: string }}
 */
export function applyResolveFinish(state) {
  const oldAttacker = state.attacker;
  const oldDefender = state.defender;
  const discardedCards = [];
  let bouncedCount = 0;
  const transitions = [createBattleClearTransition('discard', null, cardIdsInBattle(state.battle))];

  for (const slot of state.battle) {
    if (slot.returnAttackTo) {
      state.hands[slot.returnAttackTo].push(slot.attack);
      bouncedCount += 1;
    } else {
      discardedCards.push(slot.attack);
    }

    discardedCards.push(...slotDefenses(slot));
  }

  state.discardPile.push(...discardedCards);
  state.discardCount = state.discardPile.length;
  state.battle = [];

  const events = [];
  if (bouncedCount > 0) {
    events.push([`Отскок вернул ${bouncedCount} атакующих карт сопернику.`, { kind: 'effect' }]);
  }
  events.push(['Бой ушел в бито.']);

  return { transitions, events, attacker: oldAttacker, defender: oldDefender };
}
