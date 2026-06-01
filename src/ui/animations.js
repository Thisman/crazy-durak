const DEFAULT_DURATION = 600;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function rectSnapshot(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function waitForAnimation(element, fallbackMs = DEFAULT_DURATION, animationName = null) {
  if (!element) return wait(0);

  return new Promise((resolve) => {
    let isDone = false;
    const finish = () => {
      if (isDone) return;
      isDone = true;
      window.clearTimeout(timer);
      element.removeEventListener('animationend', onEnd);
      element.removeEventListener('animationcancel', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target !== element) return;
      if (animationName && event.animationName !== animationName) return;
      finish();
    };
    const timer = window.setTimeout(finish, fallbackMs + 80);

    element.addEventListener('animationend', onEnd);
    element.addEventListener('animationcancel', onEnd);
  });
}

async function waitForAnyAnimation(elements, fallbackMs = DEFAULT_DURATION) {
  const animated = elements.filter(Boolean);
  if (!animated.length) return;
  await Promise.all(animated.map((element) => waitForAnimation(element, fallbackMs)));
}

export class GameAnimations {
  constructor(elements, factories) {
    this.elements = elements;
    this.createCardElement = factories.createCardElement;
    this.createCardBackElement = factories.createCardBackElement;
  }

  play(scenario, payload = {}) {
    switch (scenario) {
      case 'opponent-turn':
        return this.playOpponentTurn();
      case 'battle-clear':
        return this.playBattleClear(payload);
      case 'table-card-enter':
        return this.playTableCardEnter(payload);
      case 'opponent-card-to-table':
        return this.playOpponentCardToTable(payload);
      case 'effect-source-wait':
        return this.playEffectSourceWait();
      case 'effect-target-pulse':
        return this.playEffectTargetPulse(payload);
      default:
        return Promise.resolve();
    }
  }

  captureOpponentCardSourceRect() {
    const source = this.elements.opponentHand.querySelector('.card-back');
    return rectSnapshot(source?.getBoundingClientRect());
  }

  async playOpponentTurn() {
    this.elements.gameScreen.classList.add('is-opponent-turn');
    this.elements.tableHint.textContent = 'Ход противника';
    await waitForAnimation(this.elements.tableDropZone, DEFAULT_DURATION, 'opponentTurnPulse');
    this.elements.gameScreen.classList.remove('is-opponent-turn');
  }

  async playBattleClear({ kind, actor } = {}) {
    const cards = [...this.elements.battleRow.querySelectorAll('.battle-slot .card')];
    if (!cards.length || !kind) return;

    this.elements.battleRow.classList.add(`battle-animate-${kind}`);
    if (actor) this.elements.battleRow.classList.add(`battle-animate-${actor}`);
    this.spawnBattleClearParticles(cards, kind);

    await waitForAnyAnimation(cards, DEFAULT_DURATION);
    cards.forEach((card) => card.classList.add('is-battle-cleared'));

    this.elements.battleRow.classList.remove(
      `battle-animate-${kind}`,
      'battle-animate-player',
      'battle-animate-ai'
    );
  }

  spawnBattleClearParticles(cards, kind) {
    const table = this.elements.tableDropZone;
    if (!table) return;

    const tableRect = table.getBoundingClientRect();
    const count = kind === 'discard' ? 7 : 6;

    for (const card of cards) {
      const cardRect = card.getBoundingClientRect();
      const burst = document.createElement('div');
      const centerX = cardRect.left + cardRect.width / 2 - tableRect.left;
      const centerY = cardRect.top + cardRect.height / 2 - tableRect.top;

      burst.className = `clear-particles clear-particles-${kind}`;
      burst.style.left = `${centerX}px`;
      burst.style.top = `${centerY}px`;

      for (let index = 0; index < count; index += 1) {
        const particle = document.createElement('span');
        const angle = (index / count) * Math.PI * 2;
        const distance = 18 + (index % 3) * 9;
        particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
        particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
        particle.style.animationDelay = `${index * 6}ms`;
        burst.append(particle);
      }

      table.append(burst);
      window.setTimeout(() => burst.remove(), 340);
    }
  }

  async playEffectSourceWait() {
    const triggered = [...this.elements.battleRow.querySelectorAll('.card.effect-trigger')];
    if (!triggered.length) return;
    await waitForAnyAnimation(triggered, 640);
  }

  async playEffectTargetPulse({ cardIds } = {}) {
    if (!cardIds?.length) return;

    const targets = cardIds
      .map((id) => document.querySelector(`[data-card-id="${CSS.escape(id)}"]`))
      .filter(Boolean);

    if (!targets.length) return;

    targets.forEach((el) => el.classList.add('effect-target-pulse'));
    await waitForAnyAnimation(targets, 640);
    targets.forEach((el) => el.classList.remove('effect-target-pulse'));
  }

  async playTableCardEnter({ cardIds } = {}) {
    const ids = new Set(cardIds ?? []);
    if (!ids.size) return;

    const cards = [...this.elements.battleRow.querySelectorAll('.card-enter')]
      .filter((element) => ids.has(element.dataset.cardId));
    await waitForAnyAnimation(cards, DEFAULT_DURATION);
  }

  async playOpponentCardToTable({ card, sourceRect, targetElement } = {}) {
    if (!card || !sourceRect || !targetElement) {
      targetElement?.classList.remove('is-animation-hidden');
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    const rotation = targetElement.classList.contains('defense-card')
      ? getComputedStyle(targetElement).getPropertyValue('--defense-rotation').trim() || '7deg'
      : '0deg';
    const flight = document.createElement('div');
    const inner = document.createElement('div');
    const back = this.createCardBackElement();
    const face = this.createCardElement(card);
    const x = targetRect.left - sourceRect.left;
    const y = targetRect.top - sourceRect.top;

    flight.className = 'ai-flight-card';
    inner.className = 'ai-flight-card-inner';
    back.classList.add('ai-flight-face', 'ai-flight-back');
    face.classList.add('ai-flight-face', 'ai-flight-front');

    flight.style.left = `${sourceRect.left}px`;
    flight.style.top = `${sourceRect.top}px`;
    flight.style.width = `${sourceRect.width}px`;
    flight.style.height = `${sourceRect.height}px`;
    flight.style.setProperty('--flight-x', `${x}px`);
    flight.style.setProperty('--flight-y', `${y}px`);
    flight.style.setProperty('--flight-mid-x', `${x * 0.54}px`);
    flight.style.setProperty('--flight-mid-y', `${(y * 0.54) - 28}px`);
    flight.style.setProperty('--flight-rotate', rotation);

    inner.append(back, face);
    flight.append(inner);
    document.body.append(flight);

    this.elements.gameScreen.classList.add('is-opponent-turn');
    this.elements.tableHint.textContent = 'Ход противника';

    await nextFrame();
    await waitForAnimation(flight, DEFAULT_DURATION, 'aiCardFlight');

    flight.remove();
    targetElement.classList.remove('is-animation-hidden');
    this.elements.gameScreen.classList.remove('is-opponent-turn');
  }
}
