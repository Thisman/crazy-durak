import { SUIT_BY_ID, createRng, sortCards } from './cards.js';
import { chooseAttackCard, chooseDefenseCard, chooseThrowInCard, chooseTransferCard } from './ai.js';
import { canCardBeatAttack, canCardTransfer, createCardModel, createFieldModel } from './model.js';
import {
  EFFECT_IDS,
  getCardEffect,
  getCardEffectId,
  hasEffect
} from './effects.js';
import {
  allDefended,
  canFinishBattle,
  canStartAttack,
  canThrowIn,
  firstUndefendedSlot,
  isSlotDefended,
  opponentOf,
  slotDefenses
} from './rules.js';
import {
  cloneBattle,
  cloneCard,
  cloneState,
  createEmptyState,
  drawCard,
  drawToSix,
  findCard,
  rebuildBattleEffectState,
  recordEvent,
  removeCard,
  setupState
} from './session.js';
import {
  aiTablePosition,
  createBattleSlot,
  defensePositionNear,
  getSlotZModel,
  moveTableGroup as moveTableGroupModel,
  normalizePosition
} from './table-model.js';
import { nextPlayOrder, startNextBattle as applyNextBattle, swapRoles as swapTurnRoles } from './turn-order.js';
import {
  createBattleClearTransition,
  createCardActionTransitions,
  createEffectPulseTransition,
  createTableGroupMoveTransition,
  normalizeTransitions
} from './transitions.js';

function publicCard(card, state, actor = 'player') {
  if (!card) return null;
  const model = createCardModel(card, state, actor);

  return {
    ...cloneCard(card),
    nominal: model.nominal,
    effectId: model.effectId,
    effectTitle: model.effectTitle,
    effectDescription: model.effectDescription,
    effectIcon: model.effectIcon,
    state: model.state,
    zone: model.zone,
    owner: model.owner,
    role: model.role,
    slotId: model.slotId,
    zIndex: model.zIndex,
    dragGroupId: model.dragGroupId,
    dragCardIds: [...(model.dragCardIds ?? [])],
    animationProfile: model.animationProfile
  };
}

function publicBattle(state) {
  return cloneBattle(state.battle).map((slot, slotIndex) => {
    const zModel = getSlotZModel(state.battle[slotIndex], slotIndex);
    return {
      ...slot,
      groupId: zModel.groupId,
      attack: publicCard(slot.attack, state),
      defense: publicCard(slot.defense, state),
      defenses: slot.defenses.map((defense) => publicCard(defense, state)),
      defenseSources: [...(slot.defenseSources ?? [])],
      defenseOrders: [...(slot.defenseOrders ?? [])],
      defenseZIndexes: [...zModel.defenseZIndexes],
      attackZIndex: zModel.attackZIndex,
      isDefended: zModel.isDefended
    };
  });
}

function battleCardIds(battle) {
  return battle.flatMap((slot) => [
    slot.attack?.id,
    ...slotDefenses(slot).map((card) => card.id)
  ]).filter(Boolean);
}

export class DurakGame {
  constructor(seed = String(Date.now()), options = {}) {
    this.seed = seed;
    this.autoAdvanceAi = options.autoAdvanceAi ?? true;
    this.rng = createRng(this.seed || String(Date.now()));
    this.state = options.state ? cloneState(options.state) : createEmptyState();
    this.pendingTransitions = [];
  }

  startGame() {
    const seed = this.seed || String(Date.now());
    this.rng = createRng(seed);
    this.state = setupState(seed, this.rng);
    if (this.autoAdvanceAi) this.advanceAi();
    return this.result(true);
  }

  getPublicState() {
    const playerHand = sortCards(this.state.hands.player, this.state.trumpSuit).map(cloneCard);
    const fieldModel = createFieldModel(this.state, 'player');
    const cardsInPlay = fieldModel.fieldCards;
    const legalTargets = {};
    const playerCardModels = [];
    const aiHandPreview = this.state.hands.ai.map((card) => (
      hasEffect(card, EFFECT_IDS.BLACK_MARK) ? publicCard(card, this.state, 'ai') : null
    ));

    for (const card of playerHand) {
      const model = createCardModel(card, this.state, 'player');
      const targets = model.isValid(cardsInPlay) ? model.getDropTargets(cardsInPlay) : [];
      legalTargets[card.id] = targets;
      playerCardModels.push({
        ...card,
        nominal: model.nominal,
        effectId: model.effectId,
        effectTitle: model.effectTitle,
        effectDescription: model.effectDescription,
        effectIcon: model.effectIcon,
        state: model.state,
        zone: model.zone,
        owner: model.owner,
        role: model.role,
        slotId: model.slotId,
        zIndex: model.zIndex,
        dragGroupId: model.dragGroupId,
        dragCardIds: [...(model.dragCardIds ?? [])],
        animationProfile: model.animationProfile,
        canDrag: model.canDrag(),
        isValid: targets.length > 0
      });
    }

    return {
      phase: this.state.phase,
      winner: this.state.winner,
      battleNumber: this.state.battleNumber,
      trumpSuit: this.state.trumpSuit,
      trumpSymbol: this.state.trumpSuit ? SUIT_BY_ID[this.state.trumpSuit].symbol : '—',
      trumpLabel: this.state.trumpSuit ? SUIT_BY_ID[this.state.trumpSuit].label : '—',
      trumpCard: publicCard(this.state.trumpCard, this.state),
      deckCount: this.state.deck.length,
      discardCount: (this.state.discardPile ?? []).length || this.state.discardCount,
      aiCardCount: this.state.hands.ai.length,
      aiHandPreview,
      playerCardCount: this.state.hands.player.length,
      playerHand: playerCardModels,
      battle: publicBattle(this.state),
      discardCards: fieldModel.discardCards,
      deckCards: fieldModel.deckCards,
      enemyCards: fieldModel.enemyCards,
      playerCards: fieldModel.playerCards,
      fieldCards: fieldModel.fieldCards,
      attacker: this.state.attacker,
      defender: this.state.defender,
      playerRole: this.state.attacker === 'player' ? 'attacker' : 'defender',
      canTake: this.canPlayerTake(),
      canFinish: canFinishBattle(this.state, 'player'),
      legalTargets,
      effectPulseIds: [...(this.state.effectPulseIds ?? [])],
      lastEvent: this.state.lastEvent,
      eventLog: [...(this.state.eventLog ?? [])]
    };
  }

  playCardToTarget(cardId, target) {
    return this.playCardToTargetAt(cardId, target, null);
  }

  playCardToTargetAt(cardId, target, position = null) {
    const card = findCard(this.state.hands.player, cardId);
    const fieldModel = createFieldModel(this.state, 'player');
    const cardModel = createCardModel(card, this.state, 'player');
    const targets = cardModel.isValid(fieldModel.fieldCards)
      ? cardModel.getDropTargets(fieldModel.fieldCards)
      : [];
    const resolvedTarget = this.resolveDropTarget(target, targets, card);

    if (!resolvedTarget) {
      return this.result(false, 'Эту карту нельзя положить сюда.');
    }

    if (resolvedTarget === 'table') {
      if (this.state.attacker === 'player') {
        return this.state.battle.length === 0
          ? this.playAttack(cardId, position)
          : this.throwIn(cardId, position);
      }

      return this.transfer(cardId, position);
    }

    if (resolvedTarget.startsWith('attack-card:')) {
      const defensePosition = target === 'table' ? null : position;
      return this.playDefense(resolvedTarget.replace('attack-card:', ''), cardId, defensePosition);
    }

    return this.result(false, 'Неизвестная цель для карты.');
  }

  resolveDropTarget(target, targets, card) {
    if (target !== 'table') {
      return targets.includes(target) ? target : null;
    }

    if (this.state.attacker === 'player' && targets.includes('table')) {
      return 'table';
    }

    if (this.state.defender === 'player' && targets.includes('table') && canCardTransfer(card, this.state, 'player')) {
      return targets.includes('table') ? 'table' : null;
    }

    return targets.find((item) => item.startsWith('attack-card:')) ?? (targets.includes('table') ? 'table' : null);
  }

  playAttack(cardId, position = null) {
    if (!canStartAttack(this.state, 'player')) {
      return this.result(false, 'Сейчас нельзя атаковать.');
    }

    const card = removeCard(this.state.hands.player, cardId);
    if (!card) return this.result(false, 'Карта не найдена среди карт игрока.');

    const slot = createBattleSlot(this.state, card, position, 'player');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'attack', { actor: 'player' }));
    recordEvent(this.state, `Вы атаковали картой ${card.rank}${card.symbol}.`);
    this.applyPlayedCardEffect(card, 'player', { slot, role: 'attack' });
    return this.afterPlayerAction();
  }

  throwIn(cardId, position = null) {
    const card = findCard(this.state.hands.player, cardId);
    if (!card || !canThrowIn(this.state, 'player', card)) {
      return this.result(false, 'Эту карту нельзя подкинуть.');
    }

    removeCard(this.state.hands.player, cardId);
    const slot = createBattleSlot(this.state, card, position, 'player');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'throw-in', { actor: 'player' }));
    recordEvent(this.state, `Вы подкинули ${card.rank}${card.symbol}.`);
    this.applyPlayedCardEffect(card, 'player', { slot, role: 'throw-in' });
    return this.afterPlayerAction();
  }

  playDefense(attackCardId, defenseCardId, position = null) {
    if (this.state.defender !== 'player') {
      return this.result(false, 'Сейчас вы не защищаетесь.');
    }

    const slot = this.state.battle.find((item) => item.attack.id === attackCardId);
    const defense = findCard(this.state.hands.player, defenseCardId);

    if (!slot || isSlotDefended(slot)) return this.result(false, 'Эту карту уже нельзя бить.');
    if (!defense || !canCardBeatAttack(defense, slot.attack, this.state)) {
      return this.result(false, 'Эта карта не бьет выбранную атаку.');
    }

    removeCard(this.state.hands.player, defenseCardId);
    const defensePosition = normalizePosition(position, defensePositionNear(slot));
    slot.defenses ??= slot.defense ? [slot.defense] : [];
    slot.defensePositions ??= slot.defensePosition ? [slot.defensePosition] : [];
    slot.defenseSources ??= [];
    slot.defenseOrders ??= Number.isFinite(slot.defenseOrder) ? [slot.defenseOrder] : [];
    const defenseOrder = nextPlayOrder(this.state);
    slot.defenses.push(defense);
    slot.defensePositions.push(defensePosition);
    slot.defenseSources.push('player');
    slot.defenseOrders.push(defenseOrder);
    slot.defense = defense;
    slot.defensePosition = defensePosition;
    slot.defenseOrder = defenseOrder;
    this.enqueueTransitions(createCardActionTransitions(defense.id, 'defense', {
      actor: 'player',
      targetCardId: slot.attack.id
    }));
    recordEvent(this.state, `Вы отбились картой ${defense.rank}${defense.symbol}.`);
    this.applyDefenseInteractionEffects(defense, 'player', slot);
    return this.afterPlayerAction();
  }

  transfer(cardId, position = null) {
    if (this.state.defender !== 'player') {
      return this.result(false, 'Сейчас перевод невозможен.');
    }

    const card = findCard(this.state.hands.player, cardId);
    if (!card || !canCardTransfer(card, this.state, 'player')) {
      return this.result(false, 'Эту карту нельзя перевести.');
    }

    removeCard(this.state.hands.player, cardId);
    const slot = createBattleSlot(this.state, card, position, 'player');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'transfer', { actor: 'player' }));
    this.applyPlayedCardEffect(card, 'player', { slot, role: 'transfer' });
    this.swapRoles();
    this.state.defenderStartHandCount = this.state.hands[this.state.defender].length;
    recordEvent(this.state, `Вы перевели ход картой ${card.rank}${card.symbol}.`);
    return this.afterPlayerAction();
  }

  takeCards() {
    if (!this.canPlayerTake()) {
      return this.result(false, 'Сейчас нечего брать.');
    }

    this.aiThrowWhilePlayerTakes();
    this.resolveTake('player');
    return this.afterPlayerAction();
  }

  finishBattle() {
    if (!canFinishBattle(this.state, 'player')) {
      return this.result(false, 'Бой еще не завершен.');
    }

    this.resolveFinish();
    return this.afterPlayerAction();
  }

  moveTableGroup(groupId, position) {
    const moved = moveTableGroupModel(this.state, groupId, position);
    if (!moved) return this.result(false, 'Эту группу карт нельзя переместить.');

    this.enqueueTransitions(createTableGroupMoveTransition(groupId, moved.position, moved.cardIds));
    return this.result(true);
  }

  canPlayerTake() {
    return this.state.phase === 'playing'
      && this.state.defender === 'player'
      && this.state.battle.some((slot) => !isSlotDefended(slot));
  }

  afterPlayerAction() {
    if (this.autoAdvanceAi) this.advanceAi();
    this.checkGameOver();
    return this.result(true);
  }

  advanceOpponent() {
    this.advanceAi();
    this.checkGameOver();
    return this.result(true);
  }

  enqueueTransitions(transitions) {
    this.pendingTransitions.push(...normalizeTransitions(transitions));
  }

  flushTransitions() {
    const transitions = normalizeTransitions(this.pendingTransitions);
    this.pendingTransitions = [];
    return transitions;
  }

  result(ok, error = null) {
    return {
      ok,
      error,
      state: this.getPublicState(),
      transitions: this.flushTransitions()
    };
  }

  cancelCardEffect(card) {
    const effect = getCardEffect(card);
    if (!effect) return null;

    delete card.effect;
    delete card.effectId;
    return effect;
  }

  resolveNullifyInteraction(slot, defense) {
    const interactions = [];
    const attackHadNullifier = hasEffect(slot.attack, EFFECT_IDS.NULLIFY_EFFECT);
    const defenseHadNullifier = hasEffect(defense, EFFECT_IDS.NULLIFY_EFFECT);

    if (attackHadNullifier) interactions.push({ nullifier: slot.attack, target: defense });
    if (defenseHadNullifier) interactions.push({ nullifier: defense, target: slot.attack });
    if (!interactions.length) return false;

    const canceled = [];

    for (const interaction of interactions) {
      const effect = this.cancelCardEffect(interaction.target);
      if (!effect) continue;
      canceled.push({ ...interaction, effect });
    }

    if (!canceled.length) return false;

    rebuildBattleEffectState(this.state);
    this.state.effectPulseIds = [
      ...new Set(canceled.flatMap((item) => [item.nullifier.id, item.target.id]).filter(Boolean))
    ];
    this.enqueueTransitions(createEffectPulseTransition(this.state.effectPulseIds));

    for (const item of canceled) {
      recordEvent(
        this.state,
        `глушитель ${item.nullifier.rank}${item.nullifier.symbol} отменил эффект «${item.effect.title}» у ${item.target.rank}${item.target.symbol}.`,
        { kind: 'effect' }
      );
    }

    return true;
  }

  applyDefenseInteractionEffects(defense, actor, slot) {
    this.resolveNullifyInteraction(slot, defense);

    if (!getCardEffectId(defense) || hasEffect(defense, EFFECT_IDS.NULLIFY_EFFECT)) return null;

    return this.applyPlayedCardEffect(defense, actor, {
      slot,
      coveredSlot: slot,
      coveredCard: slot.attack,
      role: 'defense'
    });
  }

  applyPlayedCardEffect(card, actor, context = {}) {
    this.state.effectPulseIds = [];
    const model = createCardModel(card, this.state, actor);
    if (!model.effectId) return null;

    const zones = createFieldModel(this.state, actor, { mutable: true });
    const outcome = zones.apply(model, {
      ...context,
      card,
      state: this.state,
      actor,
      enemy: opponentOf(actor),
      random: this.rng
    });

    this.state.discardCount = (this.state.discardPile ?? []).length;
    if (Array.isArray(outcome?.pulseIds)) {
      this.state.effectPulseIds = [...new Set(outcome.pulseIds.filter(Boolean))];
      this.enqueueTransitions(createEffectPulseTransition(this.state.effectPulseIds));
    }

    if (outcome?.applied && outcome.message) {
      recordEvent(this.state, `эффект ${card.rank}${card.symbol}: ${outcome.message}.`, { kind: 'effect' });
    }

    return outcome;
  }

  swapRoles() {
    swapTurnRoles(this.state);
  }

  advanceAi() {
    let guard = 0;

    while (this.state.phase === 'playing' && guard < 80) {
      guard += 1;

      if (this.state.battle.length === 0) {
        this.checkGameOver();
        if (this.state.phase !== 'playing') break;
        if (this.state.attacker === 'ai') {
          this.aiAttack();
          break;
        }
        break;
      }

      if (this.state.defender === 'ai') {
        const transferred = this.aiMaybeTransfer();
        if (transferred) continue;

        const slot = firstUndefendedSlot(this.state.battle);
        if (!slot) break;

        const defense = chooseDefenseCard(this.state.hands.ai, slot.attack, this.state.trumpSuit, this.state);
        if (!defense) {
          this.resolveTake('ai');
          continue;
        }

        removeCard(this.state.hands.ai, defense.id);
        const defensePosition = defensePositionNear(slot);
        slot.defenses ??= slot.defense ? [slot.defense] : [];
        slot.defensePositions ??= slot.defensePosition ? [slot.defensePosition] : [];
        slot.defenseSources ??= [];
        slot.defenseOrders ??= Number.isFinite(slot.defenseOrder) ? [slot.defenseOrder] : [];
        const defenseOrder = nextPlayOrder(this.state);
        slot.defenses.push(defense);
        slot.defensePositions.push(defensePosition);
        slot.defenseSources.push('ai');
        slot.defenseOrders.push(defenseOrder);
        slot.defense = defense;
        slot.defensePosition = defensePosition;
        slot.defenseOrder = defenseOrder;
        this.enqueueTransitions(createCardActionTransitions(defense.id, 'defense', {
          actor: 'ai',
          targetCardId: slot.attack.id
        }));
        recordEvent(this.state, `ИИ отбился картой ${defense.rank}${defense.symbol}.`);
        this.applyDefenseInteractionEffects(defense, 'ai', slot);

        break;
      }

      if (this.state.attacker === 'ai') {
        if (allDefended(this.state.battle)) {
          const throwCard = chooseThrowInCard(this.state.hands.ai, this.state, 'ai');
          if (throwCard) {
            removeCard(this.state.hands.ai, throwCard.id);
            const slot = createBattleSlot(this.state, throwCard, aiTablePosition(this.state), 'ai');
            this.state.battle.push(slot);
            this.enqueueTransitions(createCardActionTransitions(throwCard.id, 'throw-in', { actor: 'ai' }));
            recordEvent(this.state, `ИИ подкинул ${throwCard.rank}${throwCard.symbol}.`);
            this.applyPlayedCardEffect(throwCard, 'ai', { slot, role: 'throw-in' });
            break;
          }

          this.resolveFinish();
          continue;
        }

        break;
      }

      break;
    }
  }

  aiAttack() {
    const card = chooseAttackCard(this.state.hands.ai, this.state.trumpSuit, this.state);
    if (!card) {
      this.checkGameOver();
      return;
    }

    removeCard(this.state.hands.ai, card.id);
    const slot = createBattleSlot(this.state, card, aiTablePosition(this.state), 'ai');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'attack', { actor: 'ai' }));
    recordEvent(this.state, `ИИ атаковал картой ${card.rank}${card.symbol}.`);
    this.applyPlayedCardEffect(card, 'ai', { slot, role: 'attack' });
  }

  aiMaybeTransfer() {
    if (this.state.defender !== 'ai') return false;

    const transfer = chooseTransferCard(this.state.hands.ai, this.state, 'ai');
    if (!transfer) return false;

    removeCard(this.state.hands.ai, transfer.id);
    const slot = createBattleSlot(this.state, transfer, aiTablePosition(this.state), 'ai');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(transfer.id, 'transfer', { actor: 'ai' }));
    this.applyPlayedCardEffect(transfer, 'ai', { slot, role: 'transfer' });
    this.swapRoles();
    this.state.defenderStartHandCount = this.state.hands[this.state.defender].length;
    recordEvent(this.state, `ИИ перевел ход картой ${transfer.rank}${transfer.symbol}.`);
    return true;
  }

  aiThrowWhilePlayerTakes() {
    let throws = 0;

    while (throws < 3) {
      const card = chooseThrowInCard(this.state.hands.ai, this.state, 'ai');
      if (!card) return;

      removeCard(this.state.hands.ai, card.id);
      const slot = createBattleSlot(this.state, card, aiTablePosition(this.state), 'ai');
      this.state.battle.push(slot);
      this.enqueueTransitions(createCardActionTransitions(card.id, 'throw-in', { actor: 'ai' }));
      recordEvent(this.state, `ИИ подкинул ${card.rank}${card.symbol}.`);
      this.applyPlayedCardEffect(card, 'ai', { slot, role: 'throw-in' });
      throws += 1;
    }
  }

  resolveTake(defender) {
    const attacker = opponentOf(defender);
    const collected = [];
    let bouncedCount = 0;
    let rustDrawCount = 0;
    this.enqueueTransitions(createBattleClearTransition('take', defender, battleCardIds(this.state.battle)));

    for (const slot of this.state.battle) {
      if (slot.returnAttackTo) {
        this.state.hands[slot.returnAttackTo].push(slot.attack);
        bouncedCount += 1;
      } else {
        collected.push(slot.attack);
      }

      collected.push(...slotDefenses(slot));

      if (slot.rustyAttack && !isSlotDefended(slot)) {
        rustDrawCount += 1;
      }
    }

    this.state.hands[defender].push(...collected);

    let rustyDrawn = 0;
    for (let index = 0; index < rustDrawCount; index += 1) {
      if (drawCard(this.state, defender)) rustyDrawn += 1;
    }

    if (bouncedCount > 0) {
      recordEvent(this.state, `Отскок вернул ${bouncedCount} атакующих карт сопернику.`, { kind: 'effect' });
    }
    if (rustyDrawn > 0) {
      recordEvent(this.state, `Ржавчина заставила добрать ${rustyDrawn} карт.`, { kind: 'effect' });
    }
    recordEvent(this.state, defender === 'player'
      ? `Вы взяли ${collected.length} карт.`
      : `ИИ взял ${collected.length} карт.`);
    this.state.battle = [];
    this.drawAfterBattle(attacker, defender);
    this.startNextBattle(attacker);
  }

  resolveFinish() {
    const oldAttacker = this.state.attacker;
    const oldDefender = this.state.defender;
    const finishedCards = [];
    const returnedCards = [];
    const discardedCards = [];
    let bouncedCount = 0;
    this.enqueueTransitions(createBattleClearTransition('discard', null, battleCardIds(this.state.battle)));

    for (const slot of this.state.battle) {
      if (slot.returnAttackTo) {
        this.state.hands[slot.returnAttackTo].push(slot.attack);
        bouncedCount += 1;
      } else {
        finishedCards.push(slot.attack);
      }

      finishedCards.push(...slotDefenses(slot));
    }

    for (const card of finishedCards) {
      if (hasEffect(card, EFFECT_IDS.RETURN_FROM_DISCARD)) {
        returnedCards.push(card);
      } else {
        discardedCards.push(card);
      }
    }

    this.state.discardPile.push(...discardedCards);
    this.state.deck.push(...returnedCards);
    this.state.discardCount = this.state.discardPile.length;
    this.state.battle = [];
    if (bouncedCount > 0) {
      recordEvent(this.state, `Отскок вернул ${bouncedCount} атакующих карт сопернику.`, { kind: 'effect' });
    }
    if (returnedCards.length > 0) {
      recordEvent(this.state, `Возврат из бито отправил ${returnedCards.length} карт в низ колоды.`, { kind: 'effect' });
    }
    recordEvent(this.state, 'Бой ушел в бито.');
    this.drawAfterBattle(oldAttacker, oldDefender);
    this.startNextBattle(oldDefender);
  }

  drawAfterBattle(attacker, defender) {
    drawToSix(this.state, attacker);
    drawToSix(this.state, defender);
  }

  startNextBattle(attacker) {
    applyNextBattle(this.state, attacker);
    this.checkGameOver();
  }

  checkGameOver() {
    if (this.state.phase !== 'playing') return;
    if (this.state.battle.length > 0) return;
    if (this.state.deck.length > 0) return;

    const playerDone = this.state.hands.player.length === 0;
    const aiDone = this.state.hands.ai.length === 0;

    if (playerDone && aiDone) {
      this.state.phase = 'finished';
      this.state.winner = 'draw';
      recordEvent(this.state, 'Ничья.');
      return;
    }

    if (playerDone) {
      this.state.phase = 'finished';
      this.state.winner = 'player';
      recordEvent(this.state, 'Вы победили.');
      return;
    }

    if (aiDone) {
      this.state.phase = 'finished';
      this.state.winner = 'ai';
      recordEvent(this.state, 'ИИ победил.');
    }
  }
}

export function createGame(seed, options = {}) {
  return new DurakGame(seed, options);
}

export function createGameFromState(state, options = {}) {
  return new DurakGame('test', { ...options, state });
}
