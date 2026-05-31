import {
  EFFECT_IDS,
  applyCardEffect,
  applyEffectAnimationModifiers,
  applyEffectModelModifiers,
  getCardEffect,
  getCardEffectDescription,
  getCardEffectId,
  hasEffect
} from './effects.js';
import {
  battleCards,
  canBeat,
  canStartAttack,
  canThrowIn,
  canTransfer,
  isSlotDefended,
  opponentOf,
  slotDefenses,
  tableRanks
} from './rules.js';
import { getDragGroup, getSlotZModel, slotGroupId } from './table-model.js';

export const CARD_STATES = {
  IN_HAND: 'in_hand',
  VALID: 'valid',
  INVALID: 'invalid',
  PLAYED: 'played',
  BEATEN: 'beaten'
};

function cloneCard(card) {
  return card ? { ...card } : null;
}

function normalizeCards(cards) {
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function defaultAnimationProfile() {
  return {
    hover: { type: 'hover', durationMs: 140 },
    play: { type: 'play', durationMs: 360 },
    beat: { type: 'beat', durationMs: 360 },
    take: { type: 'take', durationMs: 240 },
    discard: { type: 'discard', durationMs: 240 },
    effectPulse: { type: 'effect-pulse', durationMs: 560 }
  };
}

export function canCardBeatAttack(defenseCard, attackCard, state) {
  if (!defenseCard || !attackCard) return false;
  if ((state.forbiddenDefenseSuits ?? []).includes(defenseCard.suit)) return false;
  if (
    hasEffect(attackCard, EFFECT_IDS.SPEAR)
    && defenseCard.suit === state.trumpSuit
    && attackCard.suit !== state.trumpSuit
  ) return false;
  return canBeat(attackCard, defenseCard, state.trumpSuit);
}

export function canCardTransfer(card, state, actor) {
  return canTransfer(state, actor, card);
}

export function getCardDropTargets(card, state, actor, cardsInPlay = battleCards(state.battle)) {
  if (!card || state.phase !== 'playing') return [];

  const normalizedCardsInPlay = normalizeCards(cardsInPlay);
  const ranksInPlay = normalizedCardsInPlay.length
    ? new Set(normalizedCardsInPlay.map((item) => item.rank))
    : tableRanks(state.battle);
  const targets = [];

  if (canStartAttack(state, actor)) {
    targets.push('table');
  }

  if (state.attacker === actor && state.battle.length > 0) {
    if (ranksInPlay.has(card.rank) && canThrowIn(state, actor, card)) {
      targets.push('table');
    }
  }

  if (canCardTransfer(card, state, actor)) {
    targets.push('table');
  }

  if (state.defender === actor) {
    const defenseTargets = state.battle
      .filter((slot) => !isSlotDefended(slot) && canCardBeatAttack(card, slot.attack, state))
      .map((slot) => `attack-card:${slot.attack.id}`);

    targets.push(...defenseTargets);

    if (defenseTargets.length > 0 && !targets.includes('table')) {
      targets.push('table');
    }
  }

  return [...new Set(targets)];
}

function findCardContext(card, state, actor, options = {}) {
  if (!card) {
    return {
      zone: null,
      owner: null,
      role: null,
      slotId: null,
      dragGroup: null,
      zIndex: null,
      cardState: CARD_STATES.IN_HAND
    };
  }

  for (const owner of ['player', 'ai']) {
    if (state.hands?.[owner]?.some((item) => item.id === card.id)) {
      return {
        zone: 'hand',
        owner,
        role: null,
        slotId: null,
        dragGroup: null,
        zIndex: null,
        cardState: resolveHandCardState(card, state, actor, owner, options)
      };
    }
  }

  const slotIndex = state.battle.findIndex((slot) => slot.attack?.id === card.id);
  if (slotIndex >= 0) {
    const slot = state.battle[slotIndex];
    const zModel = getSlotZModel(slot, slotIndex);
    return {
      zone: 'table',
      owner: slot.source ?? null,
      role: 'attack',
      slotId: slot.attack.id,
      dragGroup: getDragGroup(slot),
      zIndex: zModel.attackZIndex,
      cardState: isSlotDefended(slot) ? CARD_STATES.BEATEN : CARD_STATES.PLAYED
    };
  }

  for (let index = 0; index < state.battle.length; index += 1) {
    const slot = state.battle[index];
    const defenseIndex = slotDefenses(slot).findIndex((item) => item.id === card.id);
    if (defenseIndex < 0) continue;

    const zModel = getSlotZModel(slot, index);
    return {
      zone: 'table',
      owner: slot.defenseSources?.[defenseIndex] ?? opponentOf(slot.source),
      role: 'defense',
      slotId: slot.attack.id,
      dragGroup: getDragGroup(slot),
      zIndex: zModel.defenseZIndexes[defenseIndex] ?? null,
      cardState: CARD_STATES.PLAYED
    };
  }

  if (state.discardPile?.some((item) => item.id === card.id)) {
    return {
      zone: 'discard',
      owner: null,
      role: null,
      slotId: null,
      dragGroup: null,
      zIndex: null,
      cardState: CARD_STATES.BEATEN
    };
  }

  if (state.deck?.some((item) => item.id === card.id)) {
    return {
      zone: 'deck',
      owner: null,
      role: null,
      slotId: null,
      dragGroup: null,
      zIndex: null,
      cardState: CARD_STATES.IN_HAND
    };
  }

  return {
    zone: options.zone ?? null,
    owner: options.owner ?? null,
    role: options.role ?? null,
    slotId: options.slotId ?? null,
    dragGroup: options.dragGroup ?? null,
    zIndex: options.zIndex ?? null,
    cardState: options.cardState ?? CARD_STATES.IN_HAND
  };
}

function resolveHandCardState(card, state, actor, owner, options) {
  if (options.cardState) return options.cardState;
  if (options.classifyValidity === false || owner !== actor) return CARD_STATES.IN_HAND;
  return getCardDropTargets(card, state, actor).length > 0 ? CARD_STATES.VALID : CARD_STATES.INVALID;
}

function lifecycleIntent(cardId, lifecycle, animationProfile, extra = {}) {
  return {
    cardId,
    lifecycle,
    animation: animationProfile[lifecycle] ?? null,
    ...extra
  };
}

export function createCardModel(card, state, actor = 'player', options = {}) {
  const effect = getCardEffect(card);
  const effectId = getCardEffectId(card);
  const context = findCardContext(card, state, actor, options);
  const animationProfile = applyEffectAnimationModifiers(
    defaultAnimationProfile(),
    { card, state, actor, context }
  );
  const targets = () => getCardDropTargets(card, state, actor, battleCards(state.battle));
  const model = {
    ...cloneCard(card),
    nominal: card?.rank ?? null,
    rank: card?.rank ?? null,
    suit: card?.suit ?? null,
    effectId,
    effectTitle: effect?.title ?? null,
    effectDescription: getCardEffectDescription(card),
    effectIcon: effect?.icon ?? null,
    state: context.cardState,
    zone: context.zone,
    owner: context.owner,
    role: context.role,
    slotId: context.slotId,
    zIndex: context.zIndex,
    dragGroupId: context.dragGroup?.id ?? (context.slotId ? slotGroupId({ attack: { id: context.slotId } }) : null),
    dragCardIds: context.dragGroup?.cardIds ?? [],
    animationProfile,
    isValid(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay).length > 0;
    },
    getDropTargets(cardsInPlay) {
      return getCardDropTargets(card, state, actor, cardsInPlay);
    },
    canDrag() {
      if (this.zone === 'table') return true;
      return this.zone === 'hand' && this.owner === actor && targets().length > 0;
    },
    getDragGroup() {
      if (this.zone === 'table') {
        return {
          id: this.dragGroupId,
          cardIds: [...this.dragCardIds]
        };
      }
      return {
        id: this.id,
        cardIds: [this.id].filter(Boolean)
      };
    },
    onHoverStart() {
      return lifecycleIntent(this.id, 'hover', this.animationProfile, { phase: 'start' });
    },
    onHoverEnd() {
      return lifecycleIntent(this.id, 'hover', this.animationProfile, { phase: 'end' });
    },
    onDragStart() {
      return lifecycleIntent(this.id, 'drag', this.animationProfile, { phase: 'start' });
    },
    onDragEnd() {
      return lifecycleIntent(this.id, 'drag', this.animationProfile, { phase: 'end' });
    },
    onPlayStart() {
      return lifecycleIntent(this.id, 'play', this.animationProfile, { phase: 'start' });
    },
    onPlayCommit() {
      return lifecycleIntent(this.id, 'play', this.animationProfile, { phase: 'commit' });
    },
    onBeatStart() {
      return lifecycleIntent(this.id, 'beat', this.animationProfile, { phase: 'start' });
    },
    onBeatCommit() {
      return lifecycleIntent(this.id, 'beat', this.animationProfile, { phase: 'commit' });
    },
    onTakeStart() {
      return lifecycleIntent(this.id, 'take', this.animationProfile, { phase: 'start' });
    },
    onDiscardStart() {
      return lifecycleIntent(this.id, 'discard', this.animationProfile, { phase: 'start' });
    },
    apply(zones, applyContext = {}) {
      return applyCardEffect(this, zones, applyContext);
    }
  };

  return applyEffectModelModifiers(model, { card, state, actor, context });
}
