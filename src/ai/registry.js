import { greedyAI } from './greedy.js';
import { tacticalAI } from './tactical.js';

const strategies = new Map();
let activeId = 'tactical';

/**
 * Runtime registry for AI strategies.
 * Swap strategies at any time via setActive(id).
 *
 * @example
 * aiRegistry.register(minimaxAI);
 * aiRegistry.setActive('minimax');
 */
export const aiRegistry = {
  register(strategy) {
    strategies.set(strategy.id, strategy);
    return this;
  },

  setActive(id) {
    if (!strategies.has(id)) throw new Error(`Unknown AI strategy: "${id}"`);
    activeId = id;
    return this;
  },

  getActive() {
    const strategy = strategies.get(activeId);
    if (!strategy) throw new Error('No active AI strategy registered');
    return strategy;
  },

  list() {
    return [...strategies.values()];
  }
};

aiRegistry.register(greedyAI);
aiRegistry.register(tacticalAI);
