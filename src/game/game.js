import { createRng } from './cards.js';
import { aiRegistry } from '../ai/registry.js';
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
  cloneState,
  createEmptyState,
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
  moveTableGroup as moveTableGroupModel,
  normalizePosition
} from './table-model.js';
import { nextPlayOrder, startNextBattle as applyNextBattle, swapRoles as swapTurnRoles } from './turn-order.js';
export { GamePhase } from './lifecycle.js';
import {
  createCardActionTransitions,
  createTableGroupMoveTransition,
  normalizeTransitions
} from './transitions.js';
import { buildPublicState, canPlayerTake as canPlayerTakeSelector } from './selectors.js';
import { applyCheckGameOver, applyResolveTake, applyResolveFinish } from './reducers.js';

export class DurakGame {
  constructor(seed = String(Date.now()), options = {}) {
    this.seed = seed;
    this.autoAdvanceAi = options.autoAdvanceAi ?? true;
    this.rng = createRng(this.seed || String(Date.now()));
    this.state = options.state ? cloneState(options.state) : createEmptyState();
    this.pendingTransitions = [];
  }

  #clearEffectPulse() {
    for (const slot of this.state.battle) {
      delete slot.attack.effectPulse;
      for (const defense of (slot.defenses ?? [])) {
        delete defense.effectPulse;
      }
    }
  }

  #findBattleCard(cardId) {
    for (const slot of this.state.battle) {
      if (slot.attack?.id === cardId) return slot.attack;
      for (const defense of (slot.defenses ?? [])) {
        if (defense.id === cardId) return defense;
      }
    }
    return null;
  }

  startGame() {
    const seed = this.seed || String(Date.now());
    this.rng = createRng(seed);
    this.state = setupState(seed, this.rng);
    if (this.autoAdvanceAi) this.advanceAi();
    return this.result(true);
  }

  getPublicState() {
    return buildPublicState(this.state);
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
    this.#clearEffectPulse();
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
    this.#clearEffectPulse();
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
    this.#clearEffectPulse();
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
    this.#clearEffectPulse();
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

    this.#clearEffectPulse();
    if (moved.cardIds.length > 0) {
      const movedSlot = this.state.battle.find((slot) =>
        slot.attack?.id === moved.cardIds[0]
        || (slot.defenses ?? []).some((d) => d.id === moved.cardIds[0])
      );
      if (movedSlot && !isSlotDefended(movedSlot)) {
        for (const cardId of moved.cardIds) {
          const card = this.#findBattleCard(cardId);
          if (card && getCardEffectId(card)) card.effectPulse = true;
        }
      }
    }

    this.enqueueTransitions(createTableGroupMoveTransition(groupId, moved.position, moved.cardIds));
    return this.result(true);
  }

  canPlayerTake() {
    return canPlayerTakeSelector(this.state);
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
    for (const item of canceled) {
      const nullifierCard = this.#findBattleCard(item.nullifier.id);
      if (nullifierCard) nullifierCard.effectPulse = true;
      const targetCard = this.#findBattleCard(item.target.id);
      if (targetCard) targetCard.effectPulse = true;
    }

    for (const item of canceled) {
      recordEvent(
        this.state,
        `глушитель ${item.nullifier.rank}${item.nullifier.symbol} отменил Эффект «${item.effect.title}» у ${item.target.rank}${item.target.symbol}.`,
        { kind: 'effect' }
      );
    }

    return true;
  }

  applyDefenseInteractionEffects(defense, actor, slot) {
    this.resolveNullifyInteraction(slot, defense);

    if (!getCardEffectId(defense) || hasEffect(defense, EFFECT_IDS.NULLIFY_EFFECT)) return null;

    const defenseInBattle = this.#findBattleCard(defense.id);
    if (defenseInBattle) defenseInBattle.effectPulse = true;

    return this.applyPlayedCardEffect(defense, actor, {
      slot,
      coveredSlot: slot,
      coveredCard: slot.attack,
      role: 'defense'
    });
  }

  applyPlayedCardEffect(card, actor, context = {}) {
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
      for (const id of outcome.pulseIds) {
        if (!id) continue;
        const pulseCard = this.#findBattleCard(id);
        if (pulseCard) pulseCard.effectPulse = true;
      }
    }

    if (outcome?.spawnedCard) {
      const spawned = outcome.spawnedCard;
      const spawnedSlot = createBattleSlot(this.state, spawned, aiTablePosition(this.state), actor);
      this.state.battle.push(spawnedSlot);
      this.enqueueTransitions(createCardActionTransitions(spawned.id, 'attack', { actor }));
    }

    if (outcome?.applied && outcome.message) {
      recordEvent(this.state, `Эффект ${card.rank}${card.symbol}: ${outcome.message}.`, { kind: 'effect' });
    }

    return outcome;
  }

  swapRoles() {
    swapTurnRoles(this.state);
  }

  createAiView() {
    return {
      hand: this.state.hands.ai,
      trumpSuit: this.state.trumpSuit,
      battle: this.state.battle,
      attacker: this.state.attacker,
      defender: this.state.defender,
      phase: this.state.phase,
      blockedThrowRanks: this.state.blockedThrowRanks ?? [],
      forbiddenDefenseSuits: this.state.forbiddenDefenseSuits ?? [],
      forcedAttackSuit: this.state.forcedAttackSuit ?? null,
      defenderStartHandCount: this.state.defenderStartHandCount,
      battleNumber: this.state.battleNumber,
      hands: this.state.hands,
      deckCount: this.state.deck.length
    };
  }

  advanceAi() {
    const strategy = aiRegistry.getActive();
    let guard = 0;

    while (this.state.phase === 'playing' && guard < 80) {
      guard += 1;

      if (this.state.battle.length === 0) {
        this.checkGameOver();
        if (this.state.phase !== 'playing') break;
        if (this.state.attacker !== 'ai') break;
      }

      const action = strategy.chooseAction(this.createAiView());
      if (!action) break;

      const shouldContinue = this.executeAiAction(action);
      if (!shouldContinue) break;
    }
  }

  executeAiAction(action) {
    switch (action.type) {
      case 'attack':   this.executeAiAttack(action);   return false;
      case 'throw-in': this.executeAiThrowIn(action);  return false;
      case 'defense':  this.executeAiDefense(action);  return false;
      case 'transfer': this.executeAiTransfer(action); return true;
      case 'take':     this.resolveTake('ai');          return true;
      case 'finish':   this.resolveFinish();            return true;
      default:         return false;
    }
  }

  executeAiAttack(action) {
    const card = removeCard(this.state.hands.ai, action.cardId);
    if (!card) return;

    const slot = createBattleSlot(this.state, card, aiTablePosition(this.state), 'ai');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'attack', { actor: 'ai' }));
    recordEvent(this.state, `ИИ атаковал картой ${card.rank}${card.symbol}.`);
    this.#clearEffectPulse();
    this.applyPlayedCardEffect(card, 'ai', { slot, role: 'attack' });
  }

  executeAiDefense(action) {
    const slot = this.state.battle.find((s) => s.attack.id === action.targetCardId);
    const defense = removeCard(this.state.hands.ai, action.cardId);
    if (!slot || !defense) return;

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
    this.#clearEffectPulse();
    this.applyDefenseInteractionEffects(defense, 'ai', slot);
  }

  executeAiThrowIn(action) {
    const card = removeCard(this.state.hands.ai, action.cardId);
    if (!card) return;

    const slot = createBattleSlot(this.state, card, aiTablePosition(this.state), 'ai');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'throw-in', { actor: 'ai' }));
    recordEvent(this.state, `ИИ подкинул ${card.rank}${card.symbol}.`);
    this.#clearEffectPulse();
    this.applyPlayedCardEffect(card, 'ai', { slot, role: 'throw-in' });
  }

  executeAiTransfer(action) {
    const card = removeCard(this.state.hands.ai, action.cardId);
    if (!card) return;

    const slot = createBattleSlot(this.state, card, aiTablePosition(this.state), 'ai');
    this.state.battle.push(slot);
    this.enqueueTransitions(createCardActionTransitions(card.id, 'transfer', { actor: 'ai' }));
    this.#clearEffectPulse();
    this.applyPlayedCardEffect(card, 'ai', { slot, role: 'transfer' });
    this.swapRoles();
    this.state.defenderStartHandCount = this.state.hands[this.state.defender].length;
    recordEvent(this.state, `ИИ перевел ход картой ${card.rank}${card.symbol}.`);
  }

  aiThrowWhilePlayerTakes() {
    const strategy = aiRegistry.getActive();
    let throws = 0;

    while (throws < 3) {
      const action = strategy.chooseThrowWhileTaking?.(this.createAiView()) ?? null;
      if (!action || action.type !== 'throw-in') break;
      this.executeAiThrowIn(action);
      throws += 1;
    }
  }

  resolveTake(defender) {
    const { transitions, events, attacker } = applyResolveTake(this.state, defender);
    this.enqueueTransitions(transitions);
    events.forEach(([msg, opts]) => recordEvent(this.state, msg, opts));
    this.#drawAndStartNextBattle(attacker, defender, attacker);
  }

  resolveFinish() {
    const { transitions, events, attacker, defender } = applyResolveFinish(this.state);
    this.enqueueTransitions(transitions);
    events.forEach(([msg, opts]) => recordEvent(this.state, msg, opts));
    this.#drawAndStartNextBattle(attacker, defender, defender);
  }

  #drawAndStartNextBattle(drawFirst, drawSecond, nextAttacker) {
    drawToSix(this.state, drawFirst);
    drawToSix(this.state, drawSecond);
    applyNextBattle(this.state, nextAttacker);
    this.checkGameOver();
  }

  checkGameOver() {
    const result = applyCheckGameOver(this.state);
    if (!result) return;
    this.state.phase = result.phase;
    this.state.winner = result.winner;
    recordEvent(this.state, result.event);
  }
}

export function createGame(seed, options = {}) {
  return new DurakGame(seed, options);
}

export function createGameFromState(state, options = {}) {
  return new DurakGame('test', { ...options, state });
}
