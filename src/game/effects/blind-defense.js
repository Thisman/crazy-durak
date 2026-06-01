export const blindDefense = {
  id: 'blind_defense',
  title: 'Глухая защита',
  description: 'Эту атаку нельзя перевести. Ее можно только побить или взять.',
  icon: 'fa-solid fa-shield-halved',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike || !context.slot) return null;
    context.slot.transferBlocked = true;
    return { applied: true, message: 'эту атаку нельзя перевести', pulseIds: [cardModel.id] };
  }
};
