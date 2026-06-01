import { allDefended, canThrowIn, firstUndefendedSlot, isTrump } from '../game/rules.js';
import { canCardBeatAttack, canCardTransfer } from '../game/card-model.js';
import { getCardEffectId } from '../game/effects.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

const RANDOM_ROLE_CHANCE = 0.15;
const AGGRESSIVE_HAND_MIN = 6;
const DEFENSIVE_HAND_MAX = 3;

// ── Effect value table ────────────────────────────────────────────────────────
// Positive = this effect is beneficial to play in this context
// Negative = this effect is harmful/risky in this context

const EFFECT_VALUE = {
  attack: {
    double_cover:    8,   // defender must cover twice per slot
    clone:           7,   // spawns extra free attack card
    shackle:         6,   // freezes 2 defender cards
    blind_defense:   5,   // blocks transfers, hides table from defender
    curse:           5,   // plants black_mark in enemy hand (intel + disruption)
    forbid_suit:     4,   // bans one defense suit
    barrier:         4,   // forces attacker to same suit next (good if we have many)
    rust:            3,   // defender must draw extra if slot isn't defended
    rank_lock:       2,   // limits same-rank throw-ins
    suit_throw:      2,   // enables suit-based follow-up throw-ins
    trump_change:    2,   // evaluated dynamically below
    black_mark:      1,   // reveals a card to us
    rank_up:         1,   // card gets stronger on play
    nullify_effect:  0,   // not useful for attacking
    bounce:         -4,   // attack bounces back to us if defender takes — risky
    hand_swap:      -2,   // evaluated dynamically below
    spear:           0,
  },
  'throw-in': {
    suit_throw:      5,   // directly enables more suit-based throw-ins
    double_cover:    6,
    clone:           5,
    shackle:         5,
    rank_lock:       4,   // limits defender's options
    blind_defense:   3,
    curse:           3,
    forbid_suit:     3,
    barrier:         3,
    rust:            2,
    bounce:         -3,
    hand_swap:      -3,
    nullify_effect:  0,
    black_mark:      1,
    rank_up:         1,
    trump_change:    1,
    spear:           0,
  },
  defense: {
    nullify_effect:  8,   // cancels the attack card's effect — often a huge swing
    rank_up:         4,   // card rank improves on play, may beat stronger attacks
    barrier:         3,   // after defending, forces attacker to use same suit
    shackle:         2,   // freezes enemy cards even when we're defending
    curse:           1,
    black_mark:      1,
    rust:            1,
    forbid_suit:     1,
    trump_change:    1,
    blind_defense:  -1,
    bounce:         -2,
    double_cover:   -1,
    clone:          -1,
    hand_swap:      -2,
    suit_throw:      0,
    rank_lock:       0,
    spear:           0,
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function cardCost(card, trumpSuit) {
  return card.value + (isTrump(card, trumpSuit) ? 20 : 0);
}

function frozenSet(view) {
  return new Set(view.frozenCardIds ?? []);
}

function getEffectValue(card, context, view) {
  const effectId = getCardEffectId(card);
  if (!effectId) return 0;

  const table = EFFECT_VALUE[context] ?? {};
  let value = table[effectId] ?? 0;

  // trump_change: good if we have many cards in the card's suit but few current trumps
  if (effectId === 'trump_change' && context !== 'defense') {
    const sameSuit = view.hand.filter((c) => c.suit === card.suit && c.id !== card.id).length;
    const ownTrumps = view.hand.filter((c) => isTrump(c, view.trumpSuit)).length;
    if (sameSuit >= 2 && ownTrumps <= 1) value += 4;
    else if (sameSuit <= 0) value -= 3;
  }

  // hand_swap: only good if we have many more cards than the opponent
  if (effectId === 'hand_swap') {
    const mine = view.hand.length;
    const theirs = view.hands.player.length;
    if (mine > 6 && theirs < mine) value += 5;
    else if (theirs >= mine) value -= 6;
    else value -= 3;
  }

  // barrier: better when we have many cards of the same suit to follow up with
  if (effectId === 'barrier' && context === 'attack') {
    const sameSuit = view.hand.filter((c) => c.suit === card.suit && c.id !== card.id).length;
    if (sameSuit >= 2) value += 3;
  }

  // nullify_effect: extra bonus when the attack card actually has an effect to cancel
  if (effectId === 'nullify_effect' && context === 'defense') {
    const slot = firstUndefendedSlot(view.battle);
    if (slot && getCardEffectId(slot.attack)) value += 4;
  }

  return value;
}

// ── Role selection ────────────────────────────────────────────────────────────
// Roles shape how cards are scored and how aggressively the AI plays.
//
// aggressive — many cards in hand: attack hard, throw in everything, use effects
// defensive  — few cards in hand: protect trumps, prefer cheap plays, transfer often
// tactical   — mid-range: balanced scoring
// random     — occasional unpredictable play

function determineRole(view) {
  if (Math.random() < RANDOM_ROLE_CHANCE) return 'random';

  const mine = view.hand.length;
  const theirs = view.hands.player.length;

  if (mine >= AGGRESSIVE_HAND_MIN) return 'aggressive';
  if (mine <= DEFENSIVE_HAND_MAX) return 'defensive';

  // Mid-range: lean based on relative hand sizes
  if (theirs > mine + 1) return 'aggressive';
  if (theirs < mine - 1) return 'defensive';

  return 'tactical';
}

// ── Card scoring ──────────────────────────────────────────────────────────────
// Lower score = more preferred (used with .sort ascending).

function scoreCard(card, context, view, role) {
  const cost = cardCost(card, view.trumpSuit);
  const ev = getEffectValue(card, context, view);

  switch (role) {
    case 'aggressive':
      if (context === 'defense') return cost - ev * 3;
      // For attack/throw-in: strongly prefer effect cards, then break ties by cost
      return -ev * 100 + cost;

    case 'defensive':
      // Always prefer cheapest card; effects are a secondary tiebreaker
      return cost * 2 - ev;

    case 'random':
      return Math.random() * 100;

    default: // tactical
      return cost - ev * 5;
  }
}

function bestCard(candidates, context, view, role) {
  const frozen = frozenSet(view);
  const eligible = candidates.filter((c) => !frozen.has(c.id));
  if (eligible.length === 0) return null;
  return eligible
    .map((c) => ({ c, s: scoreCard(c, context, view, role) }))
    .sort((a, b) => a.s - b.s)[0].c;
}

// ── Individual action builders ────────────────────────────────────────────────

function buildAttackAction(view, role) {
  const card = bestCard(view.hand, 'attack', view, role);
  return card ? { type: 'attack', cardId: card.id } : null;
}

function buildDefenseAction(view, role) {
  const slot = firstUndefendedSlot(view.battle);
  if (!slot) return null;

  const candidates = view.hand.filter((c) => canCardBeatAttack(c, slot.attack, view));
  const card = bestCard(candidates, 'defense', view, role);
  return card ? { type: 'defense', cardId: card.id, targetCardId: slot.attack.id } : null;
}

function buildTransferAction(view, role) {
  const slot = firstUndefendedSlot(view.battle);
  if (!slot) return null;

  const transferable = view.hand.filter((c) => canCardTransfer(c, view, 'ai'));
  if (transferable.length === 0) return null;

  const cheapestTransfer = [...transferable].sort(
    (a, b) => cardCost(a, view.trumpSuit) - cardCost(b, view.trumpSuit)
  )[0];

  // Evaluate whether transferring beats defending
  const defenseAction = buildDefenseAction(view, role);
  if (defenseAction) {
    const defCard = view.hand.find((c) => c.id === defenseAction.cardId);
    if (defCard) {
      const defCost = cardCost(defCard, view.trumpSuit);
      const transCost = cardCost(cheapestTransfer, view.trumpSuit);

      if (role === 'aggressive' && transCost >= defCost - 2) return null;
      if (role === 'tactical' && transCost >= defCost) return null;
      // defensive always prefers transfer over spending a defense card
    }
  }

  return { type: 'transfer', cardId: cheapestTransfer.id };
}

function pickThrowInCard(view, role) {
  const candidates = view.hand.filter((c) => canThrowIn(view, 'ai', c));
  return bestCard(candidates, 'throw-in', view, role);
}

function shouldThrowIn(card, role, view) {
  if (!card) return false;
  if (role === 'aggressive') return true;
  if (role === 'random') return Math.random() > 0.4;
  if (role === 'defensive') {
    // Only discard very cheap non-trump cards
    return !isTrump(card, view.trumpSuit) && card.value <= 5;
  }
  // Tactical: throw in if cheap or has a meaningful effect
  const cost = cardCost(card, view.trumpSuit);
  const ev = getEffectValue(card, 'throw-in', view);
  return cost <= 8 || ev >= 4;
}

// ── Strategy export ───────────────────────────────────────────────────────────

export const tacticalAI = {
  id: 'tactical',
  label: 'Противник',

  chooseAction(view) {
    if (view.phase !== 'playing') return null;

    const role = determineRole(view);

    // Attacker, empty table → start new attack
    if (view.attacker === 'ai' && view.battle.length === 0) {
      return buildAttackAction(view, role);
    }

    // Defender → transfer > defend > take
    if (view.defender === 'ai') {
      const transfer = buildTransferAction(view, role);
      if (transfer) return transfer;

      const slot = firstUndefendedSlot(view.battle);
      if (!slot) return null;

      const defense = buildDefenseAction(view, role);
      if (defense) return defense;

      return { type: 'take' };
    }

    // Attacker, all slots defended → throw in or finish
    if (view.attacker === 'ai' && allDefended(view.battle)) {
      const card = pickThrowInCard(view, role);
      if (shouldThrowIn(card, role, view)) {
        return { type: 'throw-in', cardId: card.id };
      }
      return { type: 'finish' };
    }

    return null;
  },

  chooseThrowWhileTaking(view) {
    // When the player decides to take, pile on aggressively regardless of role
    const card = pickThrowInCard(view, 'aggressive');
    return card ? { type: 'throw-in', cardId: card.id } : null;
  }
};
