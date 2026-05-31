import { SUIT_BY_ID, createDeck, createRng, shuffle, sortCards } from './cards.js';
import { chooseAttackCard, chooseDefenseCard, chooseThrowInCard, chooseTransferCard } from './ai.js';
import { canCardBeatAttack, canCardTransfer, createCardModel, createFieldModel } from './model.js';
import { assignRandomEffects } from './effects.js';
import {
  HAND_TARGET,
  allDefended,
  battleCards,
  canFinishBattle,
  canStartAttack,
  canThrowIn,
  firstUndefendedSlot,
  isSlotDefended,
  opponentOf
} from './rules.js';

function cloneCard(card) {
  return card ? { ...card } : null;
}

function cloneBattle(battle) {
  return battle.map((slot) => {
    const defenses = Array.isArray(slot.defenses)
      ? slot.defenses.map(cloneCard)
      : (slot.defense ? [cloneCard(slot.defense)] : []);
    const defensePositions = Array.isArray(slot.defensePositions)
      ? slot.defensePositions.map((position) => (position ? { ...position } : null))
      : (slot.defensePosition ? [{ ...slot.defensePosition }] : []);
    const defenseSources = Array.isArray(slot.defenseSources)
      ? [...slot.defenseSources]
      : defenses.map(() => null);

    return {
      attack: cloneCard(slot.attack),
      defense: defenses.at(-1) ?? null,
      defenses,
      attackPosition: slot.attackPosition ? { ...slot.attackPosition } : null,
      defensePosition: defensePositions.at(-1) ?? null,
      defensePositions,
      defenseSources,
      attackOrder: Number.isFinite(slot.attackOrder) ? slot.attackOrder : null,
      defenseOrder: Number.isFinite(slot.defenseOrder) ? slot.defenseOrder : null,
      defenseOrders: Array.isArray(slot.defenseOrders)
        ? slot.defenseOrders.map((order) => (Number.isFinite(order) ? order : null))
        : (Number.isFinite(slot.defenseOrder) ? [slot.defenseOrder] : []),
      requiredDefenseCount: slot.requiredDefenseCount ?? 1,
      source: slot.source ?? null
    };
  });
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function normalizePosition(position, fallback = { x: 0.5, y: 0.42 }) {
  return {
    x: clamp01(position?.x ?? fallback.x),
    y: clamp01(position?.y ?? fallback.y)
  };
}

function createEmptyState() {
  return {
    phase: 'idle',
    winner: null,
    deck: [],
    trumpSuit: null,
    trumpCard: null,
    hands: { player: [], ai: [] },
    battle: [],
    discardPile: [],
    discardCount: 0,
    attacker: 'player',
    defender: 'ai',
    defenderStartHandCount: HAND_TARGET,
    battleNumber: 1,
    nextPlayOrder: 1,
    lastEvent: 'Нажмите «Начать игру».',
    eventLog: []
  };
}

function recordEvent(state, message) {
  state.lastEvent = message;
  state.eventLog = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      battleNumber: state.battleNumber,
      message
    },
    ...(state.eventLog ?? [])
  ].slice(0, 80);
}

function cloneState(state) {
  return {
    ...state,
    deck: state.deck.map(cloneCard),
    trumpCard: cloneCard(state.trumpCard),
    nextPlayOrder: Number.isFinite(state.nextPlayOrder) ? state.nextPlayOrder : null,
    hands: {
      player: state.hands.player.map(cloneCard),
      ai: state.hands.ai.map(cloneCard)
    },
    battle: cloneBattle(state.battle),
    discardPile: (state.discardPile ?? []).map(cloneCard),
    eventLog: [...(state.eventLog ?? [])]
  };
}

function removeCard(hand, cardId) {
  const index = hand.findIndex((card) => card.id === cardId);
  if (index === -1) return null;
  return hand.splice(index, 1)[0];
}

function findCard(hand, cardId) {
  return hand.find((card) => card.id === cardId) ?? null;
}

function drawCard(state, actor) {
  if (state.deck.length === 0) return null;
  const card = state.deck.shift();
  state.hands[actor].push(card);
  return card;
}

function drawToSix(state, actor) {
  while (state.hands[actor].length < HAND_TARGET && state.deck.length > 0) {
    drawCard(state, actor);
  }
}

function lowestTrumpOwner(hands, trumpSuit) {
  const playerTrump = sortCards(hands.player.filter((card) => card.suit === trumpSuit), trumpSuit)[0];
  const aiTrump = sortCards(hands.ai.filter((card) => card.suit === trumpSuit), trumpSuit)[0];

  if (!playerTrump && !aiTrump) return 'player';
  if (playerTrump && !aiTrump) return 'player';
  if (!playerTrump && aiTrump) return 'ai';
  return playerTrump.value <= aiTrump.value ? 'player' : 'ai';
}

function aiTablePosition(state) {
  const index = state.battle.length;
  const row = Math.floor(index / 4);
  const column = index % 4;
  return normalizePosition({
    x: 0.5 + (column - 1.5) * 0.14,
    y: 0.42 + row * 0.18
  });
}

function defensePositionNear(slot) {
  return normalizePosition({
    x: (slot.attackPosition?.x ?? 0.5) + 0.035,
    y: (slot.attackPosition?.y ?? 0.42) + 0.08
  });
}

function maxPlayOrder(state) {
  let maxOrder = 0;

  for (const slot of state.battle ?? []) {
    if (Number.isFinite(slot.attackOrder)) maxOrder = Math.max(maxOrder, slot.attackOrder);
    if (Number.isFinite(slot.defenseOrder)) maxOrder = Math.max(maxOrder, slot.defenseOrder);
    for (const order of slot.defenseOrders ?? []) {
      if (Number.isFinite(order)) maxOrder = Math.max(maxOrder, order);
    }
  }

  return maxOrder;
}

function nextPlayOrder(state) {
  if (!Number.isFinite(state.nextPlayOrder)) {
    state.nextPlayOrder = maxPlayOrder(state) + 1;
  }

  const order = state.nextPlayOrder;
  state.nextPlayOrder += 1;
  return order;
}

function positionsOverlap(a, b) {
  return Math.abs(a.x - b.x) < 0.14 && Math.abs(a.y - b.y) < 0.22;
}

function hasActiveAttackOverlap(state, position) {
  return state.battle.some((slot) => (
    !isSlotDefended(slot) && positionsOverlap(position, normalizePosition(slot.attackPosition))
  ));
}

function resolveAttackPosition(state, position, avoidOverlap) {
  const start = normalizePosition(position);
  if (!avoidOverlap || !hasActiveAttackOverlap(state, start)) return start;

  const shift = 0.18;
  const candidates = [
    { ...start, x: clamp01(start.x + shift) },
    { ...start, x: clamp01(start.x - shift) },
    { ...start, x: clamp01(start.x + shift * 1.35) },
    { ...start, x: clamp01(start.x - shift * 1.35) }
  ].sort((a, b) => Math.abs(a.x - start.x) - Math.abs(b.x - start.x));

  return candidates.find((candidate) => !hasActiveAttackOverlap(state, candidate)) ?? candidates[0] ?? start;
}

function createBattleSlot(state, attack, position, source = 'player', options = {}) {
  const attackPosition = source === 'ai'
    ? normalizePosition(position, { x: 0.5, y: 0.42 })
    : resolveAttackPosition(state, position, options.avoidActiveAttackOverlap);

  return {
    attack,
    defense: null,
    defenses: [],
    attackPosition,
    defensePosition: null,
    defensePositions: [],
    defenseSources: [],
    attackOrder: nextPlayOrder(state),
    defenseOrder: null,
    defenseOrders: [],
    requiredDefenseCount: 1,
    source
  };
}

function publicCard(card, state, actor = 'player') {
  if (!card) return null;
  const model = createCardModel(card, state, actor);

  return {
    ...cloneCard(card),
    nominal: model.nominal,
    effectId: model.effectId,
    effectTitle: model.effectTitle,
    effectDescription: model.effectDescription,
    effectIcon: model.effectIcon
  };
}

function publicBattle(state) {
  return cloneBattle(state.battle).map((slot) => ({
    ...slot,
    attack: publicCard(slot.attack, state),
    defense: publicCard(slot.defense, state),
    defenses: slot.defenses.map((defense) => publicCard(defense, state)),
    defenseSources: [...(slot.defenseSources ?? [])],
    defenseOrders: [...(slot.defenseOrders ?? [])],
    isDefended: isSlotDefended(slot)
  }));
}

function setupState(seed, rng = createRng(seed)) {
  const deck = shuffle(assignRandomEffects(createDeck(), rng), rng);
  const state = createEmptyState();

  state.deck = deck.slice(HAND_TARGET * 2);
  state.hands.player = deck.slice(0, HAND_TARGET);
  state.hands.ai = deck.slice(HAND_TARGET, HAND_TARGET * 2);
  state.trumpCard = state.deck[state.deck.length - 1] ?? null;
  state.trumpSuit = state.trumpCard?.suit ?? null;
  state.attacker = lowestTrumpOwner(state.hands, state.trumpSuit);
  state.defender = opponentOf(state.attacker);
  state.defenderStartHandCount = state.hands[state.defender].length;
  state.phase = 'playing';
  recordEvent(state, state.attacker === 'player'
    ? 'Вы ходите первым.'
    : 'ИИ ходит первым.');

  return state;
}

export class DurakGame {
  constructor(seed = String(Date.now()), options = {}) {
    this.seed = seed;
    this.autoAdvanceAi = options.autoAdvanceAi ?? true;
    this.rng = createRng(this.seed || String(Date.now()));
    this.state = options.state ? cloneState(options.state) : createEmptyState();
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
    const slot = createBattleSlot(this.state, card, position, 'player', { avoidActiveAttackOverlap: true });
    this.state.battle.push(slot);
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
    recordEvent(this.state, `Вы отбились картой ${defense.rank}${defense.symbol}.`);
    this.applyPlayedCardEffect(defense, 'player', {
      slot,
      coveredSlot: slot,
      coveredCard: slot.attack,
      role: 'defense'
    });
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

  result(ok, error = null) {
    return {
      ok,
      error,
      state: this.getPublicState()
    };
  }

  applyPlayedCardEffect(card, actor, context = {}) {
    const model = createCardModel(card, this.state, actor);
    if (!model.effectId) return null;

    const zones = createFieldModel(this.state, actor, { mutable: true });
    const outcome = zones.apply(model, {
      ...context,
      state: this.state,
      actor,
      enemy: opponentOf(actor),
      random: this.rng
    });

    this.state.discardCount = (this.state.discardPile ?? []).length;

    if (outcome?.applied && outcome.message) {
      recordEvent(this.state, `Эффект ${card.rank}${card.symbol}: ${outcome.message}.`);
    }

    return outcome;
  }

  swapRoles() {
    const nextAttacker = this.state.defender;
    this.state.defender = this.state.attacker;
    this.state.attacker = nextAttacker;
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
        recordEvent(this.state, `ИИ отбился картой ${defense.rank}${defense.symbol}.`);
        this.applyPlayedCardEffect(defense, 'ai', {
          slot,
          coveredSlot: slot,
          coveredCard: slot.attack,
          role: 'defense'
        });

        break;
      }

      if (this.state.attacker === 'ai') {
        if (allDefended(this.state.battle)) {
          const throwCard = chooseThrowInCard(this.state.hands.ai, this.state, 'ai');
          if (throwCard) {
            removeCard(this.state.hands.ai, throwCard.id);
            const slot = createBattleSlot(this.state, throwCard, aiTablePosition(this.state), 'ai');
            this.state.battle.push(slot);
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
      recordEvent(this.state, `ИИ подкинул ${card.rank}${card.symbol}.`);
      this.applyPlayedCardEffect(card, 'ai', { slot, role: 'throw-in' });
      throws += 1;
    }
  }

  resolveTake(defender) {
    const attacker = opponentOf(defender);
    const collected = battleCards(this.state.battle);

    this.state.hands[defender].push(...collected);

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
    const finishedCards = battleCards(this.state.battle);
    this.state.discardPile.push(...finishedCards);
    this.state.discardCount = this.state.discardPile.length;
    this.state.battle = [];
    recordEvent(this.state, 'Бой ушел в бито.');
    this.drawAfterBattle(oldAttacker, oldDefender);
    this.startNextBattle(oldDefender);
  }

  drawAfterBattle(attacker, defender) {
    drawToSix(this.state, attacker);
    drawToSix(this.state, defender);
  }

  startNextBattle(attacker) {
    this.state.battleNumber += 1;
    this.state.attacker = attacker;
    this.state.defender = opponentOf(attacker);
    this.state.defenderStartHandCount = this.state.hands[this.state.defender].length;
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
