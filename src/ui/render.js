import { cardLabel } from '../game/cards.js';
import { GameAnimations } from './animations.js';

function clear(element) {
  element.replaceChildren();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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

  if (card.effectTitle && options.showEffectBadge !== false) {
    element.classList.add('has-effect');
    element.dataset.effectTitle = card.effectTitle;
    element.dataset.effectDescription = card.effectDescription ?? '';
    element.dataset.effectIcon = card.effectIcon ?? 'fa-solid fa-star';

    const badge = document.createElement('span');
    badge.className = 'effect-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = `<i class="${element.dataset.effectIcon}"></i>`;
    element.append(badge);
  }

  return element;
}

function createActiveEffectIcon(card, actor) {
  if (!card?.effectTitle) return null;
  const owner = actor === 'ai' ? 'ai' : 'player';

  const icon = document.createElement('span');
  icon.className = `active-effect-icon active-effect-${owner}`;
  icon.dataset.effectTitle = card.effectTitle;
  icon.dataset.effectDescription = card.effectDescription ?? '';
  icon.dataset.effectIcon = card.effectIcon ?? 'fa-solid fa-star';
  icon.setAttribute('aria-label', card.effectTitle);
  icon.innerHTML = `<i class="${icon.dataset.effectIcon}" aria-hidden="true"></i>`;
  return icon;
}

function createCardBackElement() {
  const element = document.createElement('div');
  element.className = 'card card-back';
  element.setAttribute('aria-label', 'Карта противника');
  element.innerHTML = '<span></span>';
  return element;
}

function normalizedPositionValue(value, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizeBattlePosition(position, fallback = { x: 0.5, y: 0.42 }) {
  return {
    x: normalizedPositionValue(position?.x, fallback.x),
    y: normalizedPositionValue(position?.y, fallback.y)
  };
}

function setSlotPosition(element, position) {
  const { x, y } = normalizeBattlePosition(position);
  element.style.left = `${x * 100}%`;
  element.style.top = `${y * 100}%`;
  element.style.transform = 'translate(-50%, -50%)';
  element.dataset.positionX = String(x);
  element.dataset.positionY = String(y);
}

function playOrder(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function setCardZ(element, zIndex) {
  element.style.zIndex = String(Math.max(1, Math.round(zIndex)));
}

function slotPosition(element) {
  return {
    x: Number(element?.dataset.positionX),
    y: Number(element?.dataset.positionY)
  };
}

function defenseLayout(slot, index, battleRect) {
  const storedPosition = slot.defensePositions?.[index] ?? (index === 0 ? slot.defensePosition : null);
  const shouldUseStoredPosition = storedPosition && slot.defenseSources?.[index] !== 'ai';

  if (shouldUseStoredPosition && battleRect?.width && battleRect?.height) {
    const attackPosition = normalizeBattlePosition(slot.attackPosition);
    const defensePosition = normalizeBattlePosition(storedPosition, {
      x: attackPosition.x + 0.035,
      y: attackPosition.y + 0.08
    });

    return {
      x: (defensePosition.x - attackPosition.x) * battleRect.width,
      y: (defensePosition.y - attackPosition.y) * battleRect.height,
      rotation: index % 2 ? 8 : -5
    };
  }

  if ((slot.requiredDefenseCount ?? 1) > 1) {
    const doubleCover = [
      { x: -22, y: 30, rotation: -7 },
      { x: 26, y: 30, rotation: 8 }
    ];

    return doubleCover[index] ?? {
      x: 2 + index * 10,
      y: 42 + index * 6,
      rotation: index % 2 ? 9 : -9
    };
  }

  return {
    x: 20 + index * 18,
    y: 30 + index * 10,
    rotation: 7 + index * 4
  };
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
    this.animations = new GameAnimations(elements, {
      createCardElement,
      createCardBackElement
    });
    this.bindEffectTooltip();
  }

  render(state, options = {}) {
    this.state = state;
    this.renderOptions = {
      hiddenCardIds: new Set(options.hiddenCardIds ?? []),
      suppressEnterCardIds: new Set(options.suppressEnterCardIds ?? [])
    };
    this.elements.battleNumber.textContent = String(state.battleNumber);
    this.elements.discardCount.textContent = String(state.discardCount);
    this.elements.deckCount.textContent = String(state.deckCount);

    this.renderOpponent(state);
    this.renderTrumpCard(state);
    this.renderEventLog(state);
    this.renderBattle(state);
    this.renderHand(state);
    this.renderButtons(state);

    this.renderOptions = null;

    if (state.phase === 'finished') {
      this.showResult(state);
    }
  }

  renderBattle(state) {
    const previousCardIds = this.renderedBattleCardIds;
    const currentCardIds = new Set();
    const battleRect = this.elements.battleRow.getBoundingClientRect();
    clear(this.elements.battleRow);
    this.renderActiveEffects(state);

    state.battle.forEach((slot, slotIndex) => {
      const pair = document.createElement('div');
      pair.className = 'battle-slot';
      if (!slot.isDefended) pair.dataset.dropTarget = `attack-card:${slot.attack.id}`;
      setSlotPosition(pair, slot.attackPosition);

      const slotBaseZ = slot.isDefended ? 0 : 10000;
      const attackOrder = playOrder(slot.attackOrder, slotIndex * 20 + 1);
      const attackZ = slotBaseZ + attackOrder * 2;
      const attack = createCardElement(slot.attack, {
        className: 'table-card attack-card'
      });
      setCardZ(attack, attackZ);
      if (slot.isDefended) {
        attack.classList.add('is-beaten-card');
      } else {
        attack.dataset.dropTarget = `attack-card:${slot.attack.id}`;
      }
      if (this.shouldHideCard(slot.attack.id)) attack.classList.add('is-animation-hidden');
      currentCardIds.add(slot.attack.id);
      if (this.shouldAnimateCardEnter(slot.attack.id, previousCardIds)) attack.classList.add('card-enter');
      pair.append(attack);

      const defenses = slot.defenses?.length ? slot.defenses : (slot.defense ? [slot.defense] : []);
      if (defenses.length) {
        pair.classList.add(slot.isDefended ? 'is-defended' : 'has-defense');

        defenses.forEach((defenseCard, index) => {
          currentCardIds.add(defenseCard.id);
          const defense = createCardElement(defenseCard, {
            className: 'table-card defense-card'
          });
          const layout = defenseLayout(slot, index, battleRect);
          const defenseOrder = playOrder(slot.defenseOrders?.[index] ?? slot.defenseOrder, slotIndex * 20 + index + 2);
          const defenseZ = slotBaseZ + Math.max(defenseOrder * 2, attackOrder * 2 + index + 1);
          defense.style.setProperty('--defense-x', `${layout.x}px`);
          defense.style.setProperty('--defense-y', `${layout.y}px`);
          defense.style.setProperty('--defense-rotation', `${layout.rotation}deg`);
          setCardZ(defense, defenseZ);
          if (slot.isDefended) {
            defense.classList.add('is-beaten-card');
          } else {
            defense.dataset.dropTarget = `attack-card:${slot.attack.id}`;
          }
          if (this.shouldHideCard(defenseCard.id)) defense.classList.add('is-animation-hidden');
          if (this.shouldAnimateCardEnter(defenseCard.id, previousCardIds)) defense.classList.add('card-enter');
          pair.append(defense);
        });
      }

      this.elements.battleRow.append(pair);
    });

    this.renderedBattleCardIds = currentCardIds;

    const roleText = state.playerRole === 'attacker' ? 'Атакуйте или подкиньте карту' : 'Отбейтесь, переведите или возьмите';
    this.elements.tableHint.textContent = state.battle.length ? roleText : 'Перетащите карту на поле';
  }

  shouldHideCard(cardId) {
    return this.renderOptions?.hiddenCardIds.has(cardId) ?? false;
  }

  shouldAnimateCardEnter(cardId, previousCardIds) {
    if (previousCardIds.has(cardId)) return false;
    if (this.renderOptions?.hiddenCardIds.has(cardId)) return false;
    if (this.renderOptions?.suppressEnterCardIds.has(cardId)) return false;
    return true;
  }

  renderActiveEffects(state) {
    const table = this.elements.battleRow.parentElement;
    let panel = table.querySelector('.active-effects');

    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'active-effects';
      panel.innerHTML = `
        <div class="active-effect-stack active-effect-stack-ai" aria-label="Эффекты ИИ"></div>
        <div class="active-effect-stack active-effect-stack-player" aria-label="Ваши эффекты"></div>
      `;
      table.append(panel);
    }

    const aiStack = panel.querySelector('.active-effect-stack-ai');
    const playerStack = panel.querySelector('.active-effect-stack-player');
    clear(aiStack);
    clear(playerStack);

    for (const slot of state.battle) {
      this.appendActiveEffectIcon(slot.attack, slot.source, aiStack, playerStack);

      const defenses = slot.defenses?.length ? slot.defenses : (slot.defense ? [slot.defense] : []);
      defenses.forEach((defenseCard, index) => {
        const source = slot.defenseSources?.[index] ?? (slot.source === 'player' ? 'ai' : 'player');
        this.appendActiveEffectIcon(defenseCard, source, aiStack, playerStack);
      });
    }
  }

  appendActiveEffectIcon(card, actor, aiStack, playerStack) {
    const icon = createActiveEffectIcon(card, actor);
    if (!icon) return;
    (actor === 'ai' ? aiStack : playerStack).append(icon);
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

    let currentBattle = null;

    for (const event of [...state.eventLog].reverse()) {
      if (event.battleNumber !== currentBattle) {
        currentBattle = event.battleNumber;
        const divider = document.createElement('li');
        divider.className = 'event-divider';
        divider.textContent = `---- бой ${currentBattle} ----`;
        this.elements.eventLog.append(divider);
      }

      const item = document.createElement('li');
      item.className = 'event-item';
      item.innerHTML = '<p></p>';
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

  setOpponentThinking(isThinking) {
    this.elements.gameScreen.classList.toggle('is-ai-thinking', isThinking);
    if (isThinking) this.elements.tableHint.textContent = '\u0418\u0418 \u0434\u0443\u043c\u0430\u0435\u0442';
  }

  getBattleCardElement(cardId) {
    return this.elements.battleRow.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
  }

  captureOpponentCardSourceRect() {
    return this.animations.captureOpponentCardSourceRect();
  }

  revealBattleCards(cardIds) {
    for (const cardId of cardIds) {
      this.getBattleCardElement(cardId)?.classList.remove('is-animation-hidden');
    }
  }

  async animateOpponentTurn() {
    await this.animations.play('opponent-turn');
  }

  async animateOpponentCardToTable(card, sourceRect) {
    await this.animations.play('opponent-card-to-table', {
      card,
      sourceRect,
      targetElement: this.getBattleCardElement(card.id)
    });
  }

  async waitForTableCards(cardIds) {
    await this.animations.play('table-card-enter', { cardIds });
  }

  async playCardImpact(cardId, options = {}) {
    if (prefersReducedMotion()) return;

    const cardElement = this.getBattleCardElement(cardId);
    if (!cardElement) return;

    const settlement = this.prepareCardSettlement(cardElement, options.fromPosition);
    cardElement.classList.remove('card-impact');
    void cardElement.offsetWidth;
    cardElement.classList.add('card-impact');
    this.spawnImpactParticles(cardElement);
    window.setTimeout(() => cardElement.classList.remove('card-impact'), 360);
    await wait(360);
    if (settlement) await this.animateCardSettlement(settlement);
  }

  prepareCardSettlement(cardElement, fromPosition) {
    const slot = cardElement.closest('.battle-slot');
    if (!slot || !fromPosition) return null;

    const from = normalizeBattlePosition(fromPosition);
    const to = slotPosition(slot);
    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;

    const battleRect = this.elements.battleRow.getBoundingClientRect();
    const dx = (from.x - to.x) * battleRect.width;
    const dy = (from.y - to.y) * battleRect.height;
    if (Math.hypot(dx, dy) < 2) return null;

    const fromTransform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
    const toTransform = 'translate(-50%, -50%)';
    const previousTransition = slot.style.transition;
    slot.style.transition = 'none';
    slot.style.transform = fromTransform;
    slot.style.willChange = 'transform';
    void slot.offsetWidth;

    return { slot, fromTransform, toTransform, previousTransition };
  }

  async animateCardSettlement({ slot, fromTransform, toTransform, previousTransition }) {
    await nextFrame();
    slot.style.transform = toTransform;
    const animation = slot.animate([
      { transform: fromTransform },
      { transform: toTransform }
    ], {
      duration: 320,
      easing: 'cubic-bezier(.18, .9, .24, 1)',
      fill: 'both'
    });

    await animation.finished.catch(() => {});
    animation.cancel();
    slot.style.transform = toTransform;
    slot.style.willChange = '';
    slot.style.transition = previousTransition;
  }

  spawnImpactParticles(cardElement) {
    const table = this.elements.tableDropZone;
    if (!table) return;

    const tableRect = table.getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();
    const burst = document.createElement('div');
    const centerX = cardRect.left + cardRect.width / 2 - tableRect.left;
    const centerY = cardRect.top + cardRect.height / 2 - tableRect.top;
    const count = 18;

    burst.className = 'impact-particles';
    burst.style.left = `${centerX}px`;
    burst.style.top = `${centerY}px`;

    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement('span');
      const angle = (index / count) * Math.PI * 2;
      const distance = index % 2 ? 42 : 28;
      particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
      particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
      particle.style.animationDelay = `${index * 7}ms`;
      burst.append(particle);
    }

    table.append(burst);
    window.setTimeout(() => burst.remove(), 520);
  }

  async animateBattleClear(kind, actor) {
    await this.animations.play('battle-clear', { kind, actor });
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

  bindEffectTooltip() {
    if (!this.elements.effectTooltip || !this.elements.gameScreen) return;

    this.elements.gameScreen.addEventListener('pointerover', (event) => {
      const effectTarget = event.target.closest('[data-effect-title]');
      if (effectTarget) this.showEffectTooltip(effectTarget);
    });

    this.elements.gameScreen.addEventListener('pointerout', (event) => {
      const effectTarget = event.target.closest('[data-effect-title]');
      if (effectTarget && !effectTarget.contains(event.relatedTarget)) this.hideEffectTooltip();
    });

    this.elements.gameScreen.addEventListener('focusin', (event) => {
      const effectTarget = event.target.closest('[data-effect-title]');
      if (effectTarget) this.showEffectTooltip(effectTarget);
    });

    this.elements.gameScreen.addEventListener('focusout', (event) => {
      const effectTarget = event.target.closest('[data-effect-title]');
      if (effectTarget && !effectTarget.contains(event.relatedTarget)) this.hideEffectTooltip();
    });
  }

  showEffectTooltip(cardElement) {
    const tooltip = this.elements.effectTooltip;
    tooltip.querySelector('.effect-tooltip-title').textContent = cardElement.dataset.effectTitle;
    tooltip.querySelector('.effect-tooltip-copy').textContent = cardElement.dataset.effectDescription;
    tooltip.querySelector('.effect-tooltip-icon').innerHTML = `<i class="${cardElement.dataset.effectIcon}"></i>`;

    const rect = cardElement.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 10}px`;
    tooltip.classList.remove('is-hidden');
  }

  hideEffectTooltip() {
    this.elements.effectTooltip.classList.add('is-hidden');
  }
}
