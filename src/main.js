import { createGame } from './game/game.js';
import { DragController } from './ui/drag.js';
import { GameRenderer } from './ui/render.js';

const elements = {
  startScreen: document.querySelector('#start-screen'),
  gameScreen: document.querySelector('#game-screen'),
  startButton: document.querySelector('#start-button'),
  restartButton: document.querySelector('#restart-button'),
  battleNumber: document.querySelector('#battle-number'),
  opponentHand: document.querySelector('#opponent-hand'),
  discardCount: document.querySelector('#discard-count'),
  deckCount: document.querySelector('#deck-count'),
  trumpCardSlot: document.querySelector('#trump-card-slot'),
  eventLog: document.querySelector('#event-log'),
  tableDropZone: document.querySelector('#table-drop-zone'),
  battleRow: document.querySelector('#battle-row'),
  tableHint: document.querySelector('#table-hint'),
  handViewport: document.querySelector('#player-hand-viewport'),
  playerHand: document.querySelector('#player-hand'),
  handPrev: document.querySelector('#hand-prev'),
  handNext: document.querySelector('#hand-next'),
  takeButton: document.querySelector('#take-button'),
  finishButton: document.querySelector('#finish-button'),
  resultModal: document.querySelector('#result-modal'),
  resultTitle: document.querySelector('#result-title'),
  resultCopy: document.querySelector('#result-copy'),
  modalNewGame: document.querySelector('#modal-new-game'),
  effectTooltip: document.querySelector('#effect-tooltip')
};

let game = createGame(undefined, { autoAdvanceAi: false });
let currentState = game.getPublicState();
let isAnimating = false;
const renderer = new GameRenderer(elements);
const AI_THINK_MIN_MS = 1000;
const AI_THINK_MAX_MS = 3000;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function aiThinkDelay() {
  return AI_THINK_MIN_MS + Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS);
}

function attackPositionsOverlap(a, b) {
  return Math.abs(a.x - b.x) < 0.14 && Math.abs(a.y - b.y) < 0.22;
}

function shouldAnimateAttackShift(target) {
  if (target.id !== 'table') return false;
  if (currentState.playerRole !== 'attacker') return false;
  if (!currentState.battle.length) return false;

  return currentState.battle.some((slot) => (
    !slot.isDefended && attackPositionsOverlap(target.position, slot.attackPosition)
  ));
}

async function waitForOpponentThinking() {
  renderer.setOpponentThinking(true);
  try {
    await wait(aiThinkDelay());
  } finally {
    renderer.setOpponentThinking(false);
  }
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

function isBattleSlotDefended(slot) {
  const defenseCount = slot.defenses?.length ?? (slot.defense ? 1 : 0);
  return defenseCount >= (slot.requiredDefenseCount ?? 1);
}

function getNewBattleEntries(previousState, nextState) {
  const previousIds = battleCardIds(previousState);
  return battleEntries(nextState).filter((entry) => !previousIds.has(entry.card.id));
}

function getBattleClearAnimation(previousState, nextState) {
  if (!previousState.battle.length || nextState.battle.length) return null;

  if (nextState.lastEvent.includes('взял') || nextState.lastEvent.includes('взяли')) {
    const actor = nextState.lastEvent.startsWith('Вы') ? 'player' : 'ai';
    return { kind: 'take', actor };
  }

  if (nextState.lastEvent.includes('бито')) {
    return { kind: 'discard', actor: null };
  }

  return null;
}

function shouldAiAct(state) {
  if (state.phase !== 'playing') return false;
  if (state.attacker === 'ai' && state.battle.length === 0) return true;
  if (state.defender === 'ai' && state.battle.some((slot) => !isBattleSlotDefended(slot))) return true;
  if (state.attacker === 'ai' && state.battle.length > 0 && state.battle.every((slot) => isBattleSlotDefended(slot))) return true;
  return false;
}

async function renderResult(result, options = {}) {
  if (!result.ok) {
    currentState = result.state;
    renderer.render(currentState);
    if (result.error) renderer.flashError(result.error);
    return false;
  }

  const previousState = currentState;
  const clearAnimation = getBattleClearAnimation(previousState, result.state);
  if (clearAnimation) {
    const countAnimation = clearAnimation.kind === 'discard'
      ? renderer.animateDiscardCount(previousState.discardCount, result.state.discardCount)
      : Promise.resolve();
    await Promise.all([
      renderer.animateBattleClear(clearAnimation.kind, clearAnimation.actor),
      countAnimation
    ]);
  }

  const newEntries = getNewBattleEntries(previousState, result.state);
  const animatedAiEntry = options.animateAiCards
    ? newEntries.find((entry) => entry.source === 'ai')
    : null;
  const hiddenCardIds = animatedAiEntry ? [animatedAiEntry.card.id] : [];
  const suppressEnterCardIds = [
    ...hiddenCardIds,
    ...(options.suppressEnterCardIds ?? [])
  ];

  currentState = result.state;
  renderer.render(currentState, {
    hiddenCardIds,
    suppressEnterCardIds
  });

  if (options.impactCardId) {
    await renderer.playCardImpact(options.impactCardId, {
      fromPosition: options.shiftFromPosition
    });
  }

  if (animatedAiEntry) {
    await renderer.animateOpponentCardToTable(animatedAiEntry.card, options.opponentSourceRect);
    renderer.revealBattleCards(hiddenCardIds);
  }

  const enterCardIds = newEntries
    .map((entry) => entry.card.id)
    .filter((cardId) => !suppressEnterCardIds.includes(cardId));
  if (enterCardIds.length) {
    await renderer.waitForTableCards(enterCardIds);
  }

  return true;
}

async function continueAiTurns() {
  while (shouldAiAct(currentState)) {
    await waitForOpponentThinking();

    const opponentSourceRect = renderer.captureOpponentCardSourceRect();
    const ok = await renderResult(game.advanceOpponent(), {
      animateAiCards: true,
      opponentSourceRect
    });
    if (!ok) return;
  }
}

async function runAction(action, options = {}) {
  if (isAnimating) return false;

  isAnimating = true;
  renderer.setLocked(true);
  let ok = false;
  try {
    ok = await renderResult(action(), options);
    if (ok) await continueAiTurns();
  } finally {
    renderer.setLocked(false);
    isAnimating = false;
  }

  return ok;
}

async function startNewGame() {
  if (isAnimating) return;

  isAnimating = true;
  renderer.setLocked(true);
  game = createGame(String(Date.now()), { autoAdvanceAi: false });
  renderer.showGame();
  try {
    await renderResult(game.startGame());
    await continueAiTurns();
  } finally {
    renderer.setLocked(false);
    isAnimating = false;
  }
}

function handleDrop(cardId, target) {
  const shiftFromPosition = shouldAnimateAttackShift(target) ? target.position : null;

  return runAction(
    () => game.playCardToTargetAt(cardId, target.id, target.position),
    {
      suppressEnterCardIds: [cardId],
      impactCardId: cardId,
      shiftFromPosition
    }
  );
}

new DragController({
  hand: elements.playerHand,
  getState: () => currentState,
  onDrop: handleDrop,
  onDragStart: () => renderer.hideEffectTooltip(),
  onDragEnd: () => renderer.hideEffectTooltip()
});

elements.startButton.addEventListener('click', startNewGame);
elements.restartButton.addEventListener('click', startNewGame);
elements.modalNewGame.addEventListener('click', startNewGame);
elements.takeButton.addEventListener('click', () => runAction(() => game.takeCards()));
elements.finishButton.addEventListener('click', () => runAction(() => game.finishBattle()));
elements.handPrev.addEventListener('click', () => renderer.slideHand(-1));
elements.handNext.addEventListener('click', () => renderer.slideHand(1));

renderer.render(currentState);
