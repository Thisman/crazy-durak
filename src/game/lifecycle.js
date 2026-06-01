import { allDefended } from './rules.js';

/**
 * Granular game phases.
 * While the top-level state.phase is 'idle' | 'playing' | 'finished',
 * these sub-phases let callers reason about exactly what is expected next
 * without re-deriving it from multiple state fields each time.
 */
export const GamePhase = {
  IDLE: 'idle',         // Game not started
  ATTACK: 'attack',     // Attacker must play a card (or game ends)
  DEFENSE: 'defense',   // Defender must cover an undefended slot or take
  THROW_IN: 'throw_in', // All slots defended; attacker may throw more or finish
  FINISHED: 'finished'  // Game over
};

/**
 * Compute the detailed current phase from state.
 * @param {object} state
 * @returns {string} One of GamePhase values
 */
export function detectPhase(state) {
  if (state.phase === 'idle') return GamePhase.IDLE;
  if (state.phase === 'finished') return GamePhase.FINISHED;
  if (state.battle.length === 0) return GamePhase.ATTACK;
  if (allDefended(state.battle)) return GamePhase.THROW_IN;
  return GamePhase.DEFENSE;
}

/**
 * True when the human player is expected to take an action.
 * @param {object} state
 */
export function isPlayerTurn(state) {
  const phase = detectPhase(state);
  switch (phase) {
    case GamePhase.ATTACK:   return state.attacker === 'player';
    case GamePhase.DEFENSE:  return state.defender === 'player';
    case GamePhase.THROW_IN: return state.attacker === 'player';
    default: return false;
  }
}

/**
 * True when the AI needs to take an action (used by main.js / game-controller to start the AI loop).
 * @param {object} state
 */
export function shouldAiAct(state) {
  const phase = detectPhase(state);
  switch (phase) {
    case GamePhase.ATTACK:   return state.attacker === 'ai';
    case GamePhase.DEFENSE:  return state.defender === 'ai';
    case GamePhase.THROW_IN: return state.attacker === 'ai';
    default: return false;
  }
}
