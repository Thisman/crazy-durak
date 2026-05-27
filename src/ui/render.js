import { cardLabel } from '../game/cards.js';

function clear(element) {
  element.replaceChildren();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createCardElement(card, options = {}) {
  const element = document.createElement(options.interactive ? 'button' : 'div');
  element.className = `card suit-${card.color}`;
  if (options.className) element.classList.add(...options.className.split(' '));
  if (options.interactive) element.type = 'button';
  element.dataset.cardId = card.id;
  element.setAttribute('aria-label', card.label);
  element.innerHTML = `
    <span class="card-corner">${card.rank}<span>${card.symbol}</span></span>
    <span class="card-center">${card.symbol}</span>
    <span class="card-corner card-corner-bottom">${card.rank}<span>${card.symbol}</span></span>
  `;
  return element;
}

function createCardBackElement() {
  const element = document.createElement('div');
  element.className = 'card card-back';
  element.setAttribute('aria-label', 'Карта противника');
  element.innerHTML = '<span></span>';
  return element;
}

function setSlotPosition(element, position) {
  const x = Number.isFinite(position?.x) ? position.x : 0.5;
  const y = Number.isFinite(position?.y) ? position.y : 0.42;
  element.style.left = `${x * 100}%`;
  element.style.top = `${y * 100}%`;
  element.style.transform = `translate(${-x * 100}%, ${-y * 100}%)`;
}

function resultTitle(winner) {
  if (winner === 'player') return 'Победа';
  if (winner === 'ai') return 'Поражение';
  return 'Ничья';
}

export class GameRenderer {
  constructor(elements) {
    this.elements = elements;
    this.renderedBattleCardIds = new Set();
    this.handOffset = 0;
  }

  render(state) {
    this.state = state;
    this.elements.battleNumber.textContent = String(state.battleNumber);
    this.elements.discardCount.textContent = String(state.discardCount);
    this.elements.deckCount.textContent = String(state.deckCount);

    this.renderOpponent(state);
    this.renderTrumpCard(state);
    this.renderEventLog(state);
    this.renderBattle(state);
    this.renderHand(state);
    this.renderButtons(state);

    if (state.phase === 'finished') {
      this.showResult(state);
    }
  }

  renderBattle(state) {
    const previousCardIds = this.renderedBattleCardIds;
    const currentCardIds = new Set();
    clear(this.elements.battleRow);

    for (const slot of state.battle) {
      const pair = document.createElement('div');
      pair.className = 'battle-slot';
      pair.dataset.dropTarget = `attack-card:${slot.attack.id}`;
      setSlotPosition(pair, slot.attackPosition);

      const attack = createCardElement(slot.attack, { className: 'table-card attack-card' });
      attack.dataset.dropTarget = `attack-card:${slot.attack.id}`;
      currentCardIds.add(slot.attack.id);
      if (!previousCardIds.has(slot.attack.id)) attack.classList.add('card-enter');
      pair.append(attack);

      if (slot.defense) {
        pair.classList.add('is-defended');
        currentCardIds.add(slot.defense.id);
        const defense = createCardElement(slot.defense, { className: 'table-card defense-card' });
        if (!previousCardIds.has(slot.defense.id)) defense.classList.add('card-enter');
        if (slot.defensePosition) {
          const dx = (slot.defensePosition.x - (slot.attackPosition?.x ?? 0.5)) * 100;
          const dy = (slot.defensePosition.y - (slot.attackPosition?.y ?? 0.42)) * 100;
          defense.style.setProperty('--defense-dx', `${dx}px`);
          defense.style.setProperty('--defense-dy', `${dy}px`);
        }
        pair.append(defense);
      }

      this.elements.battleRow.append(pair);
    }

    this.renderedBattleCardIds = currentCardIds;

    const roleText = state.playerRole === 'attacker' ? 'Атакуйте или подкиньте карту' : 'Отбейтесь, переведите или возьмите';
    this.elements.tableHint.textContent = state.battle.length ? roleText : 'Перетащите карту на поле';
  }

  renderHand(state) {
    clear(this.elements.playerHand);

    for (const card of state.playerHand) {
      const targets = state.legalTargets[card.id] ?? [];
      const cardElement = createCardElement(card, { interactive: true, className: 'hand-card' });
      cardElement.dataset.dropTargets = targets.join(',');
      cardElement.disabled = targets.length === 0;
      cardElement.classList.toggle('is-valid', Boolean(card.isValid));
      cardElement.title = targets.length ? `${cardLabel(card)} можно сыграть` : `${cardLabel(card)} пока нельзя сыграть`;
      this.elements.playerHand.append(cardElement);
    }

    this.updateHandSlider();
  }

  renderOpponent(state) {
    clear(this.elements.opponentHand);

    const visibleCards = Math.min(9, state.aiCardCount);
    for (let index = 0; index < visibleCards; index += 1) {
      const card = createCardBackElement();
      this.elements.opponentHand.append(card);
    }

    if (state.aiCardCount > visibleCards) {
      const rest = document.createElement('div');
      rest.className = 'opponent-extra';
      rest.textContent = `+${state.aiCardCount - visibleCards}`;
      this.elements.opponentHand.append(rest);
    }
  }

  renderTrumpCard(state) {
    clear(this.elements.trumpCardSlot);

    if (state.trumpCard && state.deckCount > 0) {
      this.elements.trumpCardSlot.append(createCardElement(state.trumpCard, { className: 'trump-card' }));
      return;
    }

    const empty = document.createElement('div');
    empty.className = 'trump-card-empty';
    empty.textContent = 'Козырь вышел';
    this.elements.trumpCardSlot.append(empty);
  }

  renderEventLog(state) {
    clear(this.elements.eventLog);

    if (!state.eventLog?.length) {
      const empty = document.createElement('li');
      empty.className = 'event-item event-empty';
      empty.textContent = 'Событий пока нет';
      this.elements.eventLog.append(empty);
      return;
    }

    for (const event of [...state.eventLog].reverse()) {
      const item = document.createElement('li');
      item.className = 'event-item';
      item.innerHTML = `<span>Бой ${event.battleNumber}</span><p></p>`;
      item.querySelector('p').textContent = event.message;
      this.elements.eventLog.append(item);
    }

    window.requestAnimationFrame(() => {
      this.elements.eventLog.scrollTop = this.elements.eventLog.scrollHeight;
    });
  }

  renderButtons(state) {
    this.elements.takeButton.disabled = !state.canTake;
    this.elements.finishButton.disabled = !state.canFinish;
  }

  slideHand(direction) {
    const amount = Math.max(160, this.elements.handViewport.clientWidth * 0.55);
    this.handOffset += direction * amount;
    this.updateHandSlider();
  }

  updateHandSlider() {
    window.requestAnimationFrame(() => {
      const viewport = this.elements.handViewport;
      const hand = this.elements.playerHand;
      const maxOffset = Math.max(0, hand.scrollWidth - viewport.clientWidth);
      this.handOffset = Math.min(maxOffset, Math.max(0, this.handOffset));
      hand.style.transform = `translateX(${-this.handOffset}px)`;
      this.elements.handPrev.disabled = this.handOffset <= 0;
      this.elements.handNext.disabled = this.handOffset >= maxOffset - 1;
      this.elements.handPrev.classList.toggle('is-hidden-control', maxOffset <= 1);
      this.elements.handNext.classList.toggle('is-hidden-control', maxOffset <= 1);
    });
  }

  setLocked(isLocked) {
    this.elements.gameScreen.classList.toggle('is-locked', isLocked);
    this.elements.gameScreen.setAttribute('aria-busy', String(isLocked));
  }

  async animateOpponentTurn() {
    this.elements.gameScreen.classList.add('is-opponent-turn');
    this.elements.tableHint.textContent = 'Ход противника';
    await wait(600);
    this.elements.gameScreen.classList.remove('is-opponent-turn');
  }

  async animateBattleClear(kind, actor) {
    if (!this.elements.battleRow.querySelector('.battle-slot')) return;

    this.elements.battleRow.classList.add(`battle-animate-${kind}`);
    if (actor) this.elements.battleRow.classList.add(`battle-animate-${actor}`);
    await wait(600);
    this.elements.battleRow.classList.remove(
      `battle-animate-${kind}`,
      'battle-animate-player',
      'battle-animate-ai'
    );
  }

  showGame() {
    this.elements.startScreen.classList.add('is-hidden');
    this.elements.gameScreen.classList.remove('is-hidden');
    this.hideResult();
  }

  showResult(state) {
    this.elements.resultTitle.textContent = resultTitle(state.winner);
    this.elements.resultCopy.textContent = `Сыграно боев: ${state.battleNumber - 1}. ${state.lastEvent}`;
    this.elements.resultModal.classList.remove('is-hidden');
  }

  hideResult() {
    this.elements.resultModal.classList.add('is-hidden');
  }

  flashError(message) {
    const item = document.createElement('li');
    item.className = 'event-item event-error';
    item.innerHTML = '<span>Ошибка</span><p></p>';
    item.querySelector('p').textContent = message;
    this.elements.eventLog.append(item);
    window.requestAnimationFrame(() => {
      this.elements.eventLog.scrollTop = this.elements.eventLog.scrollHeight;
    });
  }
}
