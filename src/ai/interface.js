/**
 * An action the AI wants to execute.
 *
 * @typedef {Object} AIAction
 * @property {'attack'|'defense'|'throw-in'|'transfer'|'take'|'finish'} type
 * @property {string} [cardId]        - Card from AI hand (attack / defense / throw-in / transfer)
 * @property {string} [targetCardId]  - Attack-slot card being defended against (defense only)
 */

/**
 * A read-only view of game state from the AI's perspective.
 * Rule functions (canThrowIn, canCardBeatAttack, canCardTransfer…) accept this object
 * as the `state` parameter because it carries the same fields they need.
 *
 * @typedef {Object} AIGameView
 * @property {Card[]}                hand                   - AI's own cards
 * @property {string}                trumpSuit
 * @property {BattleSlot[]}          battle
 * @property {'player'|'ai'}         attacker
 * @property {'player'|'ai'}         defender
 * @property {'idle'|'playing'|'finished'} phase
 * @property {string[]}              blockedThrowRanks
 * @property {string[]}              forbiddenDefenseSuits
 * @property {string|null}           forcedAttackSuit
 * @property {number}                defenderStartHandCount
 * @property {number}                battleNumber
 * @property {{player: Card[], ai: Card[]}} hands           - both hands (needed for transfer checks)
 * @property {number}                deckCount
 */

/**
 * Strategy interface — implement this to create a new AI.
 * Register with aiRegistry and call aiRegistry.setActive(id) to swap at runtime.
 *
 * @typedef {Object} AIStrategy
 * @property {string} id
 * @property {string} label
 *
 * @property {(view: AIGameView) => AIAction | null} chooseAction
 *   Main decision hook. Called each step while the AI needs to act.
 *   Return null to pass (the engine will break the AI loop).
 *
 * @property {((view: AIGameView) => AIAction | null)} [chooseThrowWhileTaking]
 *   Optional hook called repeatedly (up to 3 times) when the player decides to take.
 *   Return a throw-in action or null to stop throwing.
 */
