/**
 * Controls how effects are distributed across the deck at game start.
 *
 * assignChance  — probability (0–1) that any single card receives an effect.
 *                 At 0.35 with a 52-card deck ≈ 18 effect cards per game.
 *
 * weights       — relative likelihood of each effect being chosen.
 *                 Weight 0 (or missing key) excludes an effect from random
 *                 assignment entirely. Values are not percentages — only the
 *                 ratio between entries matters, so the scale is arbitrary.
 */
export const EFFECT_CONFIG = {
  assignChance: 0.35,

  weights: {
    // ─── Обычные (Common) ──────────────────────────────────────────────────
    // Low-disruption effects that broaden options without hard counters.

    suit_throw:     2.0,  // Сородич — passive throw-in unlock; rarely an issue for defender
    nullify_effect: 1.5,  // Глушитель — cancels enemy effect; tactical, balanced
    black_mark:     1.4,  // Черная метка — defender-first play pressure; manageable
    rust:           1.3,  // Ржавчина — mild attack debuff; doesn't block defense
    rank_lock:      1.2,  // Запор — limits same-rank throw-ins; predictable
    bounce:         1.1,  // Отскок — attack returns on take; situational risk

    // ─── Нечастые (Uncommon) ───────────────────────────────────────────────
    // Moderate impact; create interesting decisions without being oppressive.

    barrier:        0.9,  // Барьер — forces follow-up attacks to same suit
    spear:          0.9,  // Копьё — no trump defense (auto-stripped from trump cards)
    curse:          0.8,  // Проклятие — seeds black mark in enemy hand

    // ─── Редкие (Rare) ─────────────────────────────────────────────────────
    // High impact; fun to see but shouldn't dominate a session.

    forbid_suit:    0.7,  // Запрет масти — blocks a defense suit for the battle
    blind_defense:  0.6,  // Вслепую — no transfer + defender can't read table
    rank_up:        0.6,  // Перевертыш — card upgrades rank on play; volatile
    double_cover:   0.5,  // Двойная броня — defender must cover with 2 cards

    // ─── Очень редкие (Very rare) ──────────────────────────────────────────
    // Game-altering or severely disruptive; powerful when they appear.

    trump_change:   0.4,  // Знамя — changes trump suit to card's suit
    clone:          0.3,  // Двойник — spawns an extra attack card from deck
    hand_swap:      0.2,  // Обмен рук — swaps both players' entire hands
  }
};
