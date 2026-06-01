import { SUIT_BY_ID, sortCards } from './cards.js';
import { EFFECT_IDS, hasEffect, isLegendaryEffect } from './effects.js';
import { detectPhase } from './lifecycle.js';
import { canCardBeatAttack, canCardTransfer, createCardModel, createFieldModel } from './model.js';
import { canFinishBattle, isSlotDefended, slotDefenses } from './rules.js';
import { cloneBattle, cloneCard } from './session.js';
import { getSlotZModel } from './table-model.js';

// ─── Card / battle projections ─────────────────────────────────────────────────

/**
 * Project a single internal card to its public (UI-facing) representation.
 * @param {object|null} card
 * @param {object} state
 * @param {'player'|'ai'} actor
 */
export function publicCard(card, state, actor = 'player') {
  if (!card) return null;
  const model = createCardModel(card, state, actor);

  return {
    ...cloneCard(card),
    nominal: model.nominal,
    effectId: model.effectId,
    effectTitle: model.effectTitle,
    effectDescription: model.effectDescription,
    effectIcon: model.effectIcon,
    effectPulse: model.effectPulse,
    isLegendary: isLegendaryEffect(model.effectId),
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

/**
 * Project all battle slots to their public representation.
 * @param {object} state
 */
export function publicBattle(state) {
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

// ─── Pure predicates ───────────────────────────────────────────────────────────

/**
 * True when the player is eligible to take all battle cards.
 * @param {object} state
 */
export function canPlayerTake(state) {
  return state.phase === 'playing'
    && state.defender === 'player'
    && state.battle.some((slot) => !isSlotDefended(slot));
}

// ─── Full public state projection ──────────────────────────────────────────────

/**
 * Build the complete public (UI-facing) state from internal game state.
 * Pure function — does not mutate anything.
 * @param {object} state  Internal game state
 * @returns {object}      Public state consumed by GameRenderer
 */
export function buildPublicState(state) {
  const playerHand = sortCards(state.hands.player, state.trumpSuit).map(cloneCard);
  const fieldModel = createFieldModel(state, 'player');
  const cardsInPlay = fieldModel.fieldCards;
  const legalTargets = {};
  const playerCardModels = [];
  const aiHandPreview = state.hands.ai.map((card) => (
    hasEffect(card, EFFECT_IDS.BLACK_MARK) ? publicCard(card, state, 'ai') : null
  ));

  for (const card of playerHand) {
    const model = createCardModel(card, state, 'player');
    const targets = model.isValid(cardsInPlay) ? model.getDropTargets(cardsInPlay) : [];
    legalTargets[card.id] = targets;
    playerCardModels.push({
      ...card,
      nominal: model.nominal,
      effectId: model.effectId,
      effectTitle: model.effectTitle,
      effectDescription: model.effectDescription,
      effectIcon: model.effectIcon,
      isLegendary: isLegendaryEffect(model.effectId),
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
    phase: state.phase,
    gamePhase: detectPhase(state),
    winner: state.winner,
    battleNumber: state.battleNumber,
    trumpSuit: state.trumpSuit,
    trumpSymbol: state.trumpSuit ? SUIT_BY_ID[state.trumpSuit].symbol : '—',
    trumpLabel: state.trumpSuit ? SUIT_BY_ID[state.trumpSuit].label : '—',
    trumpCard: publicCard(state.trumpCard, state),
    deckCount: state.deck.length,
    discardCount: (state.discardPile ?? []).length || state.discardCount,
    aiCardCount: state.hands.ai.length,
    aiHandPreview,
    playerCardCount: state.hands.player.length,
    playerHand: playerCardModels,
    battle: publicBattle(state),
    discardCards: fieldModel.discardCards,
    deckCards: fieldModel.deckCards,
    enemyCards: fieldModel.enemyCards,
    playerCards: fieldModel.playerCards,
    fieldCards: fieldModel.fieldCards,
    attacker: state.attacker,
    defender: state.defender,
    playerRole: state.attacker === 'player' ? 'attacker' : 'defender',
    canTake: canPlayerTake(state),
    canFinish: canFinishBattle(state, 'player'),
    legalTargets,
    lastEvent: state.lastEvent,
    eventLog: [...(state.eventLog ?? [])]
  };
}
