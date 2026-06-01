import { EFFECT_CONFIG } from '../effect-config.js';
import { doubleCover } from './double-cover.js';
import { rankLock } from './rank-lock.js';
import { rust } from './rust.js';
import { rankUp } from './rank-up.js';
import { blindDefense } from './blind-defense.js';
import { bounce } from './bounce.js';
import { forbidSuit } from './forbid-suit.js';
import { spear } from './spear.js';
import { barrier } from './barrier.js';
import { clone } from './clone.js';
import { blackMark } from './black-mark.js';
import { handSwap } from './hand-swap.js';
import { nullifyEffect } from './nullify-effect.js';
import { curse } from './curse.js';
import { suitThrow } from './suit-throw.js';
import { trumpChange } from './trump-change.js';

/**
 * @typedef {Object} EffectDefinition
 * @property {string}   id
 * @property {string}   title
 * @property {string}   description
 * @property {string}   icon
 * @property {Function} apply            - (cardModel, zones, context) => outcome | null
 * @property {Function} [createPayload]  - (rng, card) => payload object (for effects with extra data)
 * @property {Function} [describePayload]- (card) => string | null (runtime description override)
 * @property {Function} [modifyCardModel]
 * @property {Function} [modifyAnimationProfile]
 */

const registry = new Map();

/**
 * Register an effect. Safe to call multiple times (last write wins).
 * @param {EffectDefinition} effect
 */
export function registerEffect(effect) {
  registry.set(effect.id, {
    apply: () => null,
    modifyCardModel: (model) => model,
    modifyAnimationProfile: (profile) => profile,
    ...effect
  });
}

const BUILT_IN_EFFECTS = [
  doubleCover, rankLock, rust, rankUp, blindDefense, bounce,
  forbidSuit, spear, barrier, clone, blackMark, handSwap, nullifyEffect, curse,
  suitThrow, trumpChange
];

BUILT_IN_EFFECTS.forEach(registerEffect);

// ─── EFFECT_IDS ──────────────────────────────────────────────────────────────────────────────
// Proxy-backed: keys are derived from the registry at access time, so newly registered effects
// are immediately visible via EFFECT_IDS.MY_NEW_EFFECT without re-importing.

export const EFFECT_IDS = new Proxy({}, {
  get(_, key) {
    if (typeof key !== 'string') return undefined;
    const id = key.toLowerCase();
    return registry.has(id) ? id : undefined;
  },
  has(_, key) {
    return typeof key === 'string' && registry.has(key.toLowerCase());
  },
  ownKeys() {
    return [...registry.keys()].map((id) => id.toUpperCase());
  },
  getOwnPropertyDescriptor(_, key) {
    if (typeof key !== 'string') return undefined;
    const id = key.toLowerCase();
    if (!registry.has(id)) return undefined;
    return { configurable: true, enumerable: true, value: id };
  }
});

// ─── Definitions list (for UI / random assignment) ───────────────────────────────────────────

export const EFFECT_DEFINITIONS = [...registry.values()];

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────

function randomItem(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

function effectPayload(effect) {
  return typeof effect === 'object' && effect ? effect : {};
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
  return registry.get(effectId) ?? null;
}

export function getCardEffect(card) {
  return getEffect(getCardEffectId(card));
}

export function getCardEffectDescription(card) {
  const effectId = getCardEffectId(card);
  const effect = getEffect(effectId);
  if (!effect) return null;
  return effect.describePayload?.(card) ?? effect.description ?? null;
}

export function hasEffect(card, effectId) {
  return getCardEffectId(card) === effectId;
}

export function hasAnyEffect(card, effectIds) {
  return effectIds.includes(getCardEffectId(card));
}

export function createEffect(effectId, rng = Math.random, card = null) {
  const effect = registry.get(effectId);
  if (effect?.createPayload) {
    return { id: effectId, ...effect.createPayload(rng, card) };
  }
  return effectId;
}

export function assignRandomEffects(cards, rng = Math.random, chance = EFFECT_CONFIG.assignChance) {
  const pool = [...registry.keys()]
    .map((id) => ({ id, weight: EFFECT_CONFIG.weights[id] ?? 0 }))
    .filter(({ weight }) => weight > 0);
  const totalWeight = pool.reduce((sum, { weight }) => sum + weight, 0);

  if (totalWeight === 0) return cards.map((card) => ({ ...card }));

  return cards.map((card) => {
    if (rng() > chance) return { ...card };

    let threshold = rng() * totalWeight;
    for (const { id, weight } of pool) {
      threshold -= weight;
      if (threshold <= 0) return { ...card, effect: createEffect(id, rng, card) };
    }
    return { ...card, effect: createEffect(pool.at(-1).id, rng, card) };
  });
}

// ─── Card model / animation modifiers ────────────────────────────────────────────────────────

export function applyEffectModelModifiers(model, context = {}) {
  const effect = getEffect(model.effectId);
  return effect?.modifyCardModel?.(model, context) ?? model;
}

export function applyEffectAnimationModifiers(animationProfile, context = {}) {
  const effect = getCardEffect(context.card);
  return effect?.modifyAnimationProfile?.({ ...animationProfile }, context) ?? animationProfile;
}

// ─── Effect application ───────────────────────────────────────────────────────────────────────

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
