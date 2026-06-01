import { createGame } from '../game/game.js';
import { shouldAiAct } from '../game/turn-order.js';

const AI_THINK_MIN_MS = 1000;
const AI_THINK_MAX_MS = 3000;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function aiThinkDelay() {
  return AI_THINK_MIN_MS + Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS);
}

function battleEntries(state) {
  return state.battle.flatMap((slot) => {
    const entries = [{ card: slot.attack, source: slot.source, role: 'attack' }];
    const defenses = slot.defenses?.length ? slot.defenses : (slot.defense ? [slot.defense] : []);

    defenses.forEach((card, index) => {
      entries.push({
        card,
        source: slot.defenseSources?.[index] ?? (slot.source === 'player' ? 'ai' : 'player'),
        role: 'defense'
      });
    });

    return entries;
  });
}

function battleCardIds(state) {
  return new Set(battleEntries(state).map((entry) => entry.card.id));
}

function getNewBattleEntries(previousState, nextState) {
  const previousIds = battleCardIds(previousState);
  return battleEntries(nextState).filter((entry) => !previousIds.has(entry.card.id));
}

/**
 * Orchestrates the game loop: player input → game action → render transitions → AI turns.
 * Owns the current game instance and the animation lock.
 */
export class GameController {
  #game;
  #renderer;
  #currentState;
  #isAnimating = false;
  #generation = 0;

  constructor(renderer) {
    this.#renderer = renderer;
    this.#game = createGame(undefined, { autoAdvanceAi: false });
    this.#currentState = this.#game.getPublicState();
  }

  get currentState() {
    return this.#currentState;
  }

  async startNewGame() {
    if (this.#isAnimating) return;

    this.#isAnimating = true;
    const gen = ++this.#generation;
    this.#renderer.setLocked(true);
    this.#game = createGame(String(Date.now()), { autoAdvanceAi: false });
    this.#renderer.showGame();
    try {
      await this.#renderResult(this.#game.startGame());
      if (this.#generation === gen) await this.#continueAiTurns(gen);
    } finally {
      if (this.#generation === gen) {
        this.#renderer.setLocked(false);
        this.#isAnimating = false;
      }
    }
  }

  goHome() {
    this.#generation++;
    this.#isAnimating = false;
    this.#renderer.setLocked(false);
    this.#game = createGame(undefined, { autoAdvanceAi: false });
    this.#currentState = this.#game.getPublicState();
    this.#renderer.showStartScreen();
  }

  handleDrop(cardId, target) {
    return this.#runAction(
      () => this.#game.playCardToTargetAt(cardId, target.id, target.position),
      { suppressEnterCardIds: [cardId], impactCardId: cardId }
    );
  }

  async handleTableMove(groupId, position) {
    if (this.#isAnimating) return false;

    const result = this.#game.moveTableGroup(groupId, position);
    this.#currentState = result.state;
    this.#renderer.render(this.#currentState);
    if (result.error) this.#renderer.flashError(result.error);
    return result.ok;
  }

  takeCards() {
    return this.#runAction(() => this.#game.takeCards());
  }

  finishBattle() {
    return this.#runAction(() => this.#game.finishBattle());
  }

  async #waitForOpponentThinking() {
    this.#renderer.setOpponentThinking(true);
    try {
      await wait(aiThinkDelay());
    } finally {
      this.#renderer.setOpponentThinking(false);
    }
  }

  async #renderResult(result, options = {}) {
    if (!result.ok) {
      this.#currentState = result.state;
      this.#renderer.render(this.#currentState);
      if (result.error) this.#renderer.flashError(result.error);
      return false;
    }

    const previousState = this.#currentState;
    const transitions = result.transitions ?? [];
    await this.#renderer.playTransitions(transitions, {
      phase: 'before-render',
      previousState,
      nextState: result.state
    });

    const newEntries = getNewBattleEntries(previousState, result.state);
    const animatedAiEntry = options.animateAiCards
      ? newEntries.find((entry) => entry.source === 'ai')
      : null;
    const hiddenCardIds = animatedAiEntry ? [animatedAiEntry.card.id] : [];
    const suppressEnterCardIds = [
      ...hiddenCardIds,
      ...(options.suppressEnterCardIds ?? [])
    ];

    this.#currentState = result.state;
    this.#renderer.render(this.#currentState, { hiddenCardIds, suppressEnterCardIds });

    if (options.impactCardId) {
      await this.#renderer.playCardImpact(options.impactCardId, {
        fromPosition: options.shiftFromPosition
      });
    }

    if (animatedAiEntry) {
      await this.#renderer.animateOpponentCardToTable(animatedAiEntry.card, options.opponentSourceRect);
      this.#renderer.revealBattleCards(hiddenCardIds);
    }

    const enterCardIds = newEntries
      .map((entry) => entry.card.id)
      .filter((cardId) => !suppressEnterCardIds.includes(cardId));
    if (enterCardIds.length) {
      await this.#renderer.waitForTableCards(enterCardIds);
    }

    return true;
  }

  async #continueAiTurns(gen) {
    while (this.#generation === gen && shouldAiAct(this.#currentState)) {
      await this.#waitForOpponentThinking();
      if (this.#generation !== gen) return;

      const opponentSourceRect = this.#renderer.captureOpponentCardSourceRect();
      const ok = await this.#renderResult(this.#game.advanceOpponent(), {
        animateAiCards: true,
        opponentSourceRect
      });
      if (!ok) return;
    }
  }

  async #runAction(action, options = {}) {
    if (this.#isAnimating) return false;

    this.#isAnimating = true;
    const gen = ++this.#generation;
    this.#renderer.setLocked(true);
    let ok = false;
    try {
      ok = await this.#renderResult(action(), options);
      if (this.#generation === gen && ok) await this.#continueAiTurns(gen);
    } finally {
      if (this.#generation === gen) {
        this.#renderer.setLocked(false);
        this.#isAnimating = false;
      }
    }

    return ok;
  }
}
