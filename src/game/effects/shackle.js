export const shackle = {
  id: 'shackle',
  title: 'Оковы',
  description: 'При розыгрыше блокирует 2 случайные карты защитника на этот бой.',
  icon: 'fa-solid fa-link',

  apply(cardModel, zones, context) {
    const { state, random } = context;
    const defenderHand = state.hands[state.defender];
    if (!defenderHand?.length) return { applied: false };

    const available = defenderHand.filter((c) => !(state.frozenCardIds ?? []).includes(c.id));
    if (!available.length) return { applied: false };

    const pool = [...available];
    const picked = [];
    while (picked.length < 2 && pool.length > 0) {
      const idx = Math.floor(random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }

    state.frozenCardIds ??= [];
    for (const c of picked) {
      if (!state.frozenCardIds.includes(c.id)) state.frozenCardIds.push(c.id);
    }

    const names = picked.map((c) => `${c.rank}${c.symbol}`).join(', ');
    return {
      applied: true,
      message: `заблокированы карты защитника: ${names}`,
      pulseIds: [cardModel.id],
      targetPulseIds: picked.map((c) => c.id)
    };
  }
};
