import { RANKS, RANK_VALUE, SUITS, SUIT_BY_ID } from './cards.js';

export const EFFECT_IDS = {
  DOUBLE_COVER: 'double_cover',
  RANK_LOCK: 'rank_lock',
  RUST: 'rust',
  RANK_UP: 'rank_up',
  BLIND_DEFENSE: 'blind_defense',
  BOUNCE: 'bounce',
  FORBID_SUIT: 'forbid_suit',
  RETURN_FROM_DISCARD: 'return_from_discard',
  BLACK_MARK: 'black_mark',
  HAND_SWAP: 'hand_swap',
  NULLIFY_EFFECT: 'nullify_effect'
};

export const EFFECT_DEFINITIONS = [
  {
    id: EFFECT_IDS.DOUBLE_COVER,
    title: 'Двойная броня',
    description: 'Эту атакующую карту нужно покрыть двумя картами.',
    icon: 'fa-solid fa-layer-group'
  },
  {
    id: EFFECT_IDS.RANK_LOCK,
    title: 'Печать номинала',
    description: 'Когда карта сыграна, этот номинал больше нельзя подкидывать до конца боя.',
    icon: 'fa-solid fa-ban'
  },
  {
    id: EFFECT_IDS.RUST,
    title: 'Ржавчина',
    description: 'Если эту атаку не побили и защитник берет, он добирает еще одну карту из колоды.',
    icon: 'fa-solid fa-biohazard'
  },
  {
    id: EFFECT_IDS.RANK_UP,
    title: 'Перевертыш',
    description: 'При розыгрыше номинал карты повышается до случайного старшего номинала, но не выше туза.',
    icon: 'fa-solid fa-arrow-up'
  },
  {
    id: EFFECT_IDS.BLIND_DEFENSE,
    title: 'Глухая защита',
    description: 'Эту атаку нельзя перевести. Ее можно только побить или взять.',
    icon: 'fa-solid fa-shield-halved'
  },
  {
    id: EFFECT_IDS.BOUNCE,
    title: 'Отскок',
    description: 'Если этой картой побили атаку, побитая карта вернется атакующему даже при взятии.',
    icon: 'fa-solid fa-rotate-left'
  },
  {
    id: EFFECT_IDS.FORBID_SUIT,
    title: 'Запрет масти',
    description: 'Защитник не может крыть выбранной мастью до конца боя.',
    icon: 'fa-solid fa-suitcase'
  },
  {
    id: EFFECT_IDS.RETURN_FROM_DISCARD,
    title: 'Возврат из бито',
    description: 'Когда карта должна уйти в бито, она возвращается в низ колоды.',
    icon: 'fa-solid fa-recycle'
  },
  {
    id: EFFECT_IDS.BLACK_MARK,
    title: 'Черная метка',
    description: 'Если карта находится у соперника, она раскрыта для игрока.',
    icon: 'fa-solid fa-eye'
  },
  {
    id: EFFECT_IDS.HAND_SWAP,
    title: 'Обмен рук',
    description: 'Когда карта сыграна, игроки меняются всеми картами на руках.',
    icon: 'fa-solid fa-right-left'
  },
  {
    id: EFFECT_IDS.NULLIFY_EFFECT,
    title: 'Глушитель',
    description: 'При столкновении отменяет эффект карты, с которой взаимодействует.',
    icon: 'fa-solid fa-volume-xmark'
  }
];

const EFFECT_BY_ID = new Map(EFFECT_DEFINITIONS.map((effect) => [effect.id, effect]));
const RANDOM_EFFECT_IDS = EFFECT_DEFINITIONS.map((effect) => effect.id);

function randomItem(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

function effectPayload(effect) {
  return typeof effect === 'object' && effect ? effect : {};
}

function suitLabel(suitId) {
  return SUIT_BY_ID[suitId]?.label ?? suitId ?? 'масть';
}

function promoteCardRank(card, rng = Math.random) {
  const index = RANKS.indexOf(card.rank);
  if (index < 0 || index >= RANKS.length - 1) return false;

  const nextRank = randomItem(RANKS.slice(index + 1), rng);
  card.rank = nextRank;
  card.value = RANK_VALUE[nextRank];
  card.label = `${nextRank} ${SUIT_BY_ID[card.suit]?.label ?? card.suit}`;
  return true;
}

export function getCardEffectId(card) {
  if (!card) return null;
  if (typeof card.effect === 'string') return card.effect;
  return card.effect?.id ?? card.effectId ?? null;
}

export function getCardEffectPayload(card) {
  return effectPayload(card?.effect);
}

export function getEffect(effectId) {
  return EFFECT_BY_ID.get(effectId) ?? null;
}

export function getCardEffect(card) {
  return getEffect(getCardEffectId(card));
}

export function getCardEffectDescription(card) {
  const effect = getCardEffect(card);
  if (!effect) return null;

  if (getCardEffectId(card) === EFFECT_IDS.FORBID_SUIT) {
    const suit = getCardEffectPayload(card).suit;
    return `Защитник не может крыть мастью: ${suitLabel(suit)}.`;
  }

  return effect.description;
}

export function hasEffect(card, effectId) {
  return getCardEffectId(card) === effectId;
}

export function hasAnyEffect(card, effectIds) {
  return effectIds.includes(getCardEffectId(card));
}

export function createEffect(effectId, rng = Math.random, card = null) {
  if (effectId === EFFECT_IDS.FORBID_SUIT) {
    const suits = SUITS.filter((suit) => suit.id !== card?.suit);

    return {
      id: effectId,
      suit: randomItem(suits.length ? suits : SUITS, rng).id
    };
  }

  return effectId;
}

export function assignRandomEffects(cards, rng = Math.random, chance = 0.38) {
  return cards.map((card) => {
    if (rng() > chance) return { ...card };
    return {
      ...card,
      effect: createEffect(randomItem(RANDOM_EFFECT_IDS, rng), rng, card)
    };
  });
}

export function applyEffectModelModifiers(model, context = {}) {
  const effect = getEffect(model.effectId);
  return effect?.modifyCardModel?.(model, context) ?? model;
}

export function applyEffectAnimationModifiers(animationProfile, context = {}) {
  const effect = getCardEffect(context.card);
  return effect?.modifyAnimationProfile?.({ ...animationProfile }, context) ?? animationProfile;
}

function applyDoubleCover(cardModel, zones, context) {
  if (!context.slot || context.role === 'defense') return null;
  context.slot.requiredDefenseCount = Math.max(context.slot.requiredDefenseCount ?? 1, 2);
  return { applied: true, message: 'атаку нужно покрыть два раза', pulseIds: [cardModel.id] };
}

function applyRankLock(cardModel, zones, context) {
  if (!context.isAttackLike) return null;
  context.state.blockedThrowRanks ??= [];
  if (!context.state.blockedThrowRanks.includes(cardModel.rank)) {
    context.state.blockedThrowRanks.push(cardModel.rank);
  }
  return { applied: true, message: `номинал ${cardModel.rank} больше нельзя подкидывать`, pulseIds: [cardModel.id] };
}

function applyRust(cardModel, zones, context) {
  if (!context.isAttackLike || !context.slot) return null;
  context.slot.rustyAttack = true;
  return { applied: true, message: 'если атаку не побьют, защитник доберет карту', pulseIds: [cardModel.id] };
}

function applyRankUp(cardModel, zones, context) {
  const changed = promoteCardRank(context.playedCard, context.random);
  if (!changed) return { applied: false };
  Object.assign(cardModel, {
    rank: context.playedCard.rank,
    value: context.playedCard.value,
    label: context.playedCard.label,
    nominal: context.playedCard.rank
  });
  return { applied: true, message: `номинал повысился до ${context.playedCard.rank}`, pulseIds: [context.playedCard.id] };
}

function applyBlindDefense(cardModel, zones, context) {
  if (!context.isAttackLike || !context.slot) return null;
  context.slot.transferBlocked = true;
  return { applied: true, message: 'эту атаку нельзя перевести', pulseIds: [cardModel.id] };
}

function applyBounce(cardModel, zones, context) {
  if (context.role !== 'defense' || !context.coveredSlot) return null;
  context.coveredSlot.returnAttackTo = context.coveredSlot.source ?? context.enemy;
  context.coveredSlot.returnAttackReason = cardModel.id;
  return {
    applied: true,
    message: 'побитая атака вернется атакующему при взятии',
    pulseIds: [cardModel.id, context.coveredCard?.id].filter(Boolean)
  };
}

function applyForbidSuit(cardModel, zones, context) {
  if (!context.isAttackLike) return null;
  const suit = getCardEffectPayload(cardModel).suit;
  if (!suit) return null;
  context.state.forbiddenDefenseSuits ??= [];
  if (!context.state.forbiddenDefenseSuits.includes(suit)) {
    context.state.forbiddenDefenseSuits.push(suit);
  }
  return {
    applied: true,
    message: `защитник не может крыть мастью ${suitLabel(suit)}`,
    pulseIds: [cardModel.id]
  };
}

function applyReturnFromDiscard(cardModel) {
  return { applied: true, message: 'карта вернется из бито в колоду', pulseIds: [cardModel.id] };
}

function applyBlackMark(cardModel) {
  return { applied: true, message: 'карта раскрыта сопернику', pulseIds: [cardModel.id] };
}

function applyHandSwap(cardModel, zones, context) {
  [context.state.hands.player, context.state.hands.ai] = [context.state.hands.ai, context.state.hands.player];
  context.state.defenderStartHandCount = context.state.hands[context.state.defender]?.length
    ?? context.state.defenderStartHandCount;
  return { applied: true, message: 'игроки обменялись руками', pulseIds: [cardModel.id] };
}

const EFFECT_APPLIERS = {
  [EFFECT_IDS.DOUBLE_COVER]: applyDoubleCover,
  [EFFECT_IDS.RANK_LOCK]: applyRankLock,
  [EFFECT_IDS.RUST]: applyRust,
  [EFFECT_IDS.RANK_UP]: applyRankUp,
  [EFFECT_IDS.BLIND_DEFENSE]: applyBlindDefense,
  [EFFECT_IDS.BOUNCE]: applyBounce,
  [EFFECT_IDS.FORBID_SUIT]: applyForbidSuit,
  [EFFECT_IDS.RETURN_FROM_DISCARD]: applyReturnFromDiscard,
  [EFFECT_IDS.BLACK_MARK]: applyBlackMark,
  [EFFECT_IDS.HAND_SWAP]: applyHandSwap
};

for (const definition of EFFECT_DEFINITIONS) {
  definition.apply = EFFECT_APPLIERS[definition.id] ?? (() => null);
  definition.modifyCardModel ??= (model) => model;
  definition.modifyAnimationProfile ??= (profile) => profile;
}

export function applyCardEffect(cardModel, zones, context = {}) {
  const effectId = getCardEffectId(cardModel);
  const state = context.state;
  const effect = getEffect(effectId);
  if (!effectId || !state || !effect?.apply) return null;

  const role = context.role;
  const applyContext = {
    ...context,
    playedCard: context.card ?? cardModel,
    role,
    slot: context.slot,
    isAttackLike: role === 'attack' || role === 'throw-in' || role === 'transfer'
  };

  return effect.apply(cardModel, zones, applyContext);
}
