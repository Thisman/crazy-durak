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
  modalNewGame: document.querySelector('#modal-new-game')
};

const ANIMATION_MS = 600;

let game = createGame(undefined, { autoAdvanceAi: false });
let currentState = game.getPublicState();
let isAnimating = false;
const renderer = new GameRenderer(elements);

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function battleCardIds(state) {
  return new Set(state.battle.flatMap((slot) => (
    slot.defense ? [slot.attack.id, slot.defense.id] : [slot.attack.id]
  )));
}

function hasNewBattleCards(previousState, nextState) {
  const previousIds = battleCardIds(previousState);
  return [...battleCardIds(nextState)].some((id) => !previousIds.has(id));
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
  if (state.defender === 'ai' && state.battle.some((slot) => !slot.defense)) return true;
  if (state.attacker === 'ai' && state.battle.length > 0 && state.battle.every((slot) => slot.defense)) return true;
  return false;
}

async function renderResult(result) {
  if (!result.ok) {
    currentState = result.state;
    renderer.render(currentState);
    if (result.error) renderer.flashError(result.error);
    return false;
  }

  const previousState = currentState;
  const clearAnimation = getBattleClearAnimation(previousState, result.state);
  if (clearAnimation) {
    await renderer.animateBattleClear(clearAnimation.kind, clearAnimation.actor);
  }

  currentState = result.state;
  renderer.render(currentState);

  if (hasNewBattleCards(previousState, currentState)) {
    await wait(ANIMATION_MS);
  }

  return true;
}

async function continueAiTurns() {
  while (shouldAiAct(currentState)) {
    await renderer.animateOpponentTurn();
    const ok = await renderResult(game.advanceOpponent());
    if (!ok) return;
  }
}

async function runAction(action) {
  if (isAnimating) return;

  isAnimating = true;
  renderer.setLocked(true);
  try {
    const ok = await renderResult(action());
    if (ok) await continueAiTurns();
  } finally {
    renderer.setLocked(false);
    isAnimating = false;
  }
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
  runAction(() => game.playCardToTargetAt(cardId, target.id, target.position));
}

new DragController({
  hand: elements.playerHand,
  getState: () => currentState,
  onDrop: handleDrop
});

elements.startButton.addEventListener('click', startNewGame);
elements.restartButton.addEventListener('click', startNewGame);
elements.modalNewGame.addEventListener('click', startNewGame);
elements.takeButton.addEventListener('click', () => runAction(() => game.takeCards()));
elements.finishButton.addEventListener('click', () => runAction(() => game.finishBattle()));
elements.handPrev.addEventListener('click', () => renderer.slideHand(-1));
elements.handNext.addEventListener('click', () => renderer.slideHand(1));

renderer.render(currentState);
