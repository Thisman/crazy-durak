function cardEffectId(card) {
  if (!card) return null;
  if (typeof card.effect === 'string') return card.effect;
  return card.effect?.id ?? card.effectId ?? null;
}

export const curse = {
  id: 'curse',
  title: 'Проклятие',
  description: 'Когда карта сыграна, случайная карта соперника без Черной метки получает её.',
  icon: 'fa-solid fa-skull',

  apply(cardModel, zones, context) {
    const enemyHand = context.state.hands[context.enemy] ?? [];
    const candidates = enemyHand.filter((card) => cardEffectId(card) !== 'black_mark');
    if (candidates.length === 0) return { applied: false };

    const target = candidates[Math.floor(context.random() * candidates.length)];
    target.effect = 'black_mark';

    return {
      applied: true,
      message: `${target.rank}${target.symbol} соперника получила Черную метку`,
      pulseIds: [cardModel.id]
    };
  }
};
