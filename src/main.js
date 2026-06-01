import { GameController } from './app/game-controller.js';
import { DragController } from './ui/drag.js';
import { GameRenderer } from './ui/render.js';
import { buildGlossary } from './ui/effect-glossary.js';

const elements = {
  startScreen: document.querySelector('#start-screen'),
  gameScreen: document.querySelector('#game-screen'),
  startButton: document.querySelector('#start-button'),
  homeButton: document.querySelector('#home-button'),
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
  helpButton: document.querySelector('#help-button'),
  glossaryModal: document.querySelector('#glossary-modal'),
  glossaryClose: document.querySelector('#glossary-close'),
  glossaryList: document.querySelector('#glossary-list'),
  resultModal: document.querySelector('#result-modal'),
  resultTitle: document.querySelector('#result-title'),
  resultCopy: document.querySelector('#result-copy'),
  modalNewGame: document.querySelector('#modal-new-game'),
  effectTooltip: document.querySelector('#effect-tooltip')
};

const renderer = new GameRenderer(elements);
const controller = new GameController(renderer);

new DragController({
  hand: elements.playerHand,
  table: elements.battleRow,
  getState: () => controller.currentState,
  onDrop: (cardId, target) => controller.handleDrop(cardId, target),
  onMoveTableGroup: (groupId, position) => controller.handleTableMove(groupId, position),
  onDragStart: () => renderer.hideEffectTooltip(),
  onDragEnd: () => renderer.hideEffectTooltip()
});

elements.startButton.addEventListener('click', () => controller.startNewGame());
elements.homeButton.addEventListener('click', () => controller.goHome());
elements.modalNewGame.addEventListener('click', () => controller.startNewGame());
elements.takeButton.addEventListener('click', () => controller.takeCards());
elements.finishButton.addEventListener('click', () => controller.finishBattle());
elements.handPrev.addEventListener('click', () => renderer.slideHand(-1));
elements.handNext.addEventListener('click', () => renderer.slideHand(1));

function openGlossary() {
  buildGlossary(elements.glossaryList);
  elements.glossaryModal.classList.remove('is-hidden');
  elements.glossaryClose.focus();
}

function closeGlossary() {
  elements.glossaryModal.classList.add('is-hidden');
}

elements.helpButton.addEventListener('click', openGlossary);
elements.glossaryClose.addEventListener('click', closeGlossary);
elements.glossaryModal.addEventListener('click', (event) => {
  if (event.target === elements.glossaryModal) closeGlossary();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.glossaryModal.classList.contains('is-hidden')) {
    closeGlossary();
  }
});

renderer.render(controller.currentState);
