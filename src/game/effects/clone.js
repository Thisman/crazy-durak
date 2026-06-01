export const clone = {
  id: 'clone',
  title: 'Двойник',
  description: 'При розыгрыше в атаку случайная карта из колоды тоже автоматически атакует.',
  icon: 'fa-solid fa-clone',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike) return null;
    if (context.state.deck.length === 0) return { applied: false };
    const spawned = context.state.deck.shift();
    return {
      applied: true,
      message: `двойник вытащил ${spawned.rank}${spawned.symbol} из колоды`,
      pulseIds: [cardModel.id],
      spawnedCard: spawned
    };
  }
};
