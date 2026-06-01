export const rust = {
  id: 'rust',
  title: 'Ржавчина',
  description: 'Если эту атаку не побили и защитник берет, он добирает еще одну карту из колоды.',
  icon: 'fa-solid fa-biohazard',

  apply(cardModel, zones, context) {
    if (!context.isAttackLike || !context.slot) return null;
    context.slot.rustyAttack = true;
    return {
      applied: true,
      message: 'если атаку не побьют, защитник доберет карту',
      pulseIds: [cardModel.id]
    };
  }
};
