export const EFFECT_IDS = {
  DOUBLE_COVER: 'double_cover'
};

export const EFFECT_DEFINITIONS = [
  {
    id: EFFECT_IDS.DOUBLE_COVER,
    title: 'Двойная броня',
    description: 'Эту атакующую карту нужно покрыть двумя картами.',
    icon: 'fa-solid fa-layer-group'
  }
];

const EFFECT_BY_ID = new Map(EFFECT_DEFINITIONS.map((effect) => [effect.id, effect]));

export function getCardEffectId(card) {
  if (!card) return null;
  if (typeof card.effect === 'string') return card.effect;
  return card.effect?.id ?? card.effectId ?? null;
}

export function getEffect(effectId) {
  return EFFECT_BY_ID.get(effectId) ?? null;
}

export function getCardEffect(card) {
  return getEffect(getCardEffectId(card));
}

export function hasEffect(card, effectId) {
  return getCardEffectId(card) === effectId;
}

export function assignRandomEffects(cards, rng = Math.random, chance = 0.38) {
  return cards.map((card) => (
    rng() > chance ? { ...card } : { ...card, effect: EFFECT_IDS.DOUBLE_COVER }
  ));
}

export function applyCardEffect(cardModel, zones, context = {}) {
  if (!hasEffect(cardModel, EFFECT_IDS.DOUBLE_COVER)) return null;
  if (!context.slot || context.role === 'defense') return null;

  context.slot.requiredDefenseCount = Math.max(context.slot.requiredDefenseCount ?? 1, 2);
  return { applied: true, message: 'атаку нужно покрыть два раза' };
}
