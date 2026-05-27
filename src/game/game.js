import { SUIT_BY_ID, createDeck, createRng, shuffle, sortCards } from './cards.js';
import { chooseAttackCard, chooseDefenseCard, chooseThrowInCard, chooseTransferCard } from './ai.js';
import { createCardModel, createFieldModel } from './model.js';
import {
  HAND_TARGET,
  allDefended,
  battleCards,
  canBeat,
  canFinishBattle,
  canStartAttack,
  canThrowIn,
  canTransfer,
  firstUndefendedSlot,
  opponentOf
} from './rules.js';

function cloneCard(card) {
  return card ? { ...card } : null;
}

function cloneBattle(battle) {
  return battle.map((slot) => ({
    attack: cloneCard(slot.attack),
    defense: cloneCard(slot.defense),
    attackPosition: slot.attackPosition ? { ...slot.attackPosition } : null,
    defensePosition: slot.defensePosition ? { ...slot.defensePosition } : null,
    source: slot.source ?? null
  }));
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

function createBattleSlot(attack, position, source = 'player') {
  return {
    attack,
    defense: null,
    attackPosition: normalizePosition(position, source === 'ai' ? { x: 0.5, y: 0.42 } : undefined),
    defensePosition: null,
    source
  };
}

function setupState(seed) {
  const rng = createRng(seed);
  const deck = shuffle(createDeck(), rng);
  const state = createEmptyState();

  for (let i = 0; i < HAND_TARGET; i += 1) {
    drawCard(state, 'player');
    drawCard(state, 'ai');
  }

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
    this.state = options.state ? cloneState(options.state) : createEmptyState();
  }

  startGame() {
    this.state = setupState(this.seed || String(Date.now()));
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
      trumpCard: cloneCard(this.state.trumpCard),
      deckCount: this.state.deck.length,
      discardCount: (this.state.discardPile ?? []).length || this.state.discardCount,
      aiCardCount: this.state.hands.ai.length,
      playerCardCount: this.state.hands.player.length,
      playerHand: playerCardModels,
      battle: cloneBattle(this.state.battle),
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
      return this.playDefense(resolvedTarget.replace('attack-card:', ''), cardId, position);
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

    if (this.state.defender === 'player' && targets.includes('table') && canTransfer(this.state, 'player', card)) {
      return targets.includes('table') ? 'table' : null;
    }

    return targets.find((item) => item.startsWith('attack-card:')) ?? (targets.includes('table') ? 'table' : null);
  }

  playAttack(cardId, position = null) {
    if (!canStartAttack(this.state, 'player')) {
      return this.result(false, 'Сейчас нельзя атаковать.');
    }

    const card = removeCard(this.state.hands.player, cardId);
    if (!card) return this.result(false, 'Карта не найдена в руке.');

    this.state.battle.push(createBattleSlot(card, position, 'player'));
    recordEvent(this.state, `Вы атаковали картой ${card.rank}${card.symbol}.`);
    return this.afterPlayerAction();
  }

  throwIn(cardId, position = null) {
    const card = findCard(this.state.hands.player, cardId);
    if (!card || !canThrowIn(this.state, 'player', card)) {
      return this.result(false, 'Эту карту нельзя подкинуть.');
    }

    removeCard(this.state.hands.player, cardId);
    this.state.battle.push(createBattleSlot(card, position, 'player'));
    recordEvent(this.state, `Вы подкинули ${card.rank}${card.symbol}.`);
    return this.afterPlayerAction();
  }

  playDefense(attackCardId, defenseCardId, position = null) {
    if (this.state.defender !== 'player') {
      return this.result(false, 'Сейчас вы не защищаетесь.');
    }

    const slot = this.state.battle.find((item) => item.attack.id === attackCardId);
    const defense = findCard(this.state.hands.player, defenseCardId);

    if (!slot || slot.defense) return this.result(false, 'Эту карту уже нельзя бить.');
    if (!defense || !canBeat(slot.attack, defense, this.state.trumpSuit)) {
      return this.result(false, 'Эта карта не бьет выбранную атаку.');
    }

    removeCard(this.state.hands.player, defenseCardId);
    slot.defense = defense;
    slot.defensePosition = normalizePosition(position, defensePositionNear(slot));
    recordEvent(this.state, `Вы отбились картой ${defense.rank}${defense.symbol}.`);
    return this.afterPlayerAction();
  }

  transfer(cardId, position = null) {
    if (this.state.defender !== 'player') {
      return this.result(false, 'Сейчас перевод невозможен.');
    }

    const card = findCard(this.state.hands.player, cardId);
    if (!card || !canTransfer(this.state, 'player', card)) {
      return this.result(false, 'Эту карту нельзя перевести.');
    }

    removeCard(this.state.hands.player, cardId);
    this.state.battle.push(createBattleSlot(card, position, 'player'));
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
      && this.state.battle.some((slot) => !slot.defense);
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

        const defense = chooseDefenseCard(this.state.hands.ai, slot.attack, this.state.trumpSuit);
        if (!defense) {
          this.resolveTake('ai');
          continue;
        }

        removeCard(this.state.hands.ai, defense.id);
        slot.defense = defense;
        slot.defensePosition = defensePositionNear(slot);
        recordEvent(this.state, `ИИ отбился картой ${defense.rank}${defense.symbol}.`);

        if (firstUndefendedSlot(this.state.battle)) continue;
        break;
      }

      if (this.state.attacker === 'ai') {
        if (allDefended(this.state.battle)) {
          const throwCard = chooseThrowInCard(this.state.hands.ai, this.state, 'ai');
          if (throwCard) {
            removeCard(this.state.hands.ai, throwCard.id);
            this.state.battle.push(createBattleSlot(throwCard, aiTablePosition(this.state), 'ai'));
            recordEvent(this.state, `ИИ подкинул ${throwCard.rank}${throwCard.symbol}.`);
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
    const card = chooseAttackCard(this.state.hands.ai, this.state.trumpSuit);
    if (!card) {
      this.checkGameOver();
      return;
    }

    removeCard(this.state.hands.ai, card.id);
    this.state.battle.push(createBattleSlot(card, aiTablePosition(this.state), 'ai'));
    recordEvent(this.state, `ИИ атаковал картой ${card.rank}${card.symbol}.`);
  }

  aiMaybeTransfer() {
    if (this.state.defender !== 'ai') return false;

    const transfer = chooseTransferCard(this.state.hands.ai, this.state, 'ai');
    if (!transfer) return false;

    removeCard(this.state.hands.ai, transfer.id);
    this.state.battle.push(createBattleSlot(transfer, aiTablePosition(this.state), 'ai'));
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
      this.state.battle.push(createBattleSlot(card, aiTablePosition(this.state), 'ai'));
      recordEvent(this.state, `ИИ подкинул ${card.rank}${card.symbol}.`);
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
