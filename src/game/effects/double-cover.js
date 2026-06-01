export const doubleCover = {
  id: 'double_cover',
  title: 'Двойная броня',
  description: 'Эту атакующую карту нужно покрыть двумя картами.',
  icon: 'fa-solid fa-layer-group',

  apply(cardModel, zones, context) {
    if (!context.slot || context.role === 'defense') return null;
    context.slot.requiredDefenseCount = Math.max(context.slot.requiredDefenseCount ?? 1, 2);
    return { applied: true, message: 'атаку нужно покрыть два раза', pulseIds: [cardModel.id] };
  }
};
