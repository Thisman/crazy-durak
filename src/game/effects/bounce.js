export const bounce = {
  id: 'bounce',
  title: 'Отскок',
  description: 'Если этой картой побили атаку, побитая карта вернется атакующему даже при взятии.',
  icon: 'fa-solid fa-rotate-left',

  apply(cardModel, zones, context) {
    if (context.role !== 'defense' || !context.coveredSlot) return null;
    context.coveredSlot.returnAttackTo = context.coveredSlot.source ?? context.enemy;
    context.coveredSlot.returnAttackReason = cardModel.id;
    return {
      applied: true,
      message: 'побитая атака вернется атакующему при взятии',
      pulseIds: [cardModel.id, context.coveredCard?.id].filter(Boolean)
    };
  }
};
