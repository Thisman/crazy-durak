export const spear = {
  id: 'spear',
  title: 'Копьё',
  description: 'Эту атаку нельзя побить козырем — только старшей картой той же масти.',
  icon: 'fa-solid fa-crosshairs',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike) return null;
    return { applied: true, message: 'эту атаку нельзя побить козырем', pulseIds: [cardModel.id] };
  }
};
