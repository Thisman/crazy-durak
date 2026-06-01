export const rankLock = {
  id: 'rank_lock',
  title: 'Вето',
  description: 'Когда карта сыграна, этот номинал больше нельзя подкидывать до конца боя.',
  icon: 'fa-solid fa-ban',

  apply(cardModel, zones, context) {
    context.state.blockedThrowRanks ??= [];
    if (!context.state.blockedThrowRanks.includes(cardModel.rank)) {
      context.state.blockedThrowRanks.push(cardModel.rank);
    }
    return {
      applied: true,
      message: `номинал ${cardModel.rank} больше нельзя подкидывать`,
      pulseIds: [cardModel.id]
    };
  }
};
