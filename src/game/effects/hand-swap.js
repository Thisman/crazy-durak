export const handSwap = {
  id: 'hand_swap',
  title: 'Обмен рук',
  description: 'Когда карта сыграна, игроки меняются всеми картами на руках.',
  icon: 'fa-solid fa-right-left',

  apply(cardModel, zones, context) {
    [context.state.hands.player, context.state.hands.ai] = [
      context.state.hands.ai,
      context.state.hands.player
    ];
    context.state.defenderStartHandCount = context.state.hands[context.state.defender]?.length
      ?? context.state.defenderStartHandCount;
    return { applied: true, message: 'игроки обменялись руками', pulseIds: [cardModel.id] };
  }
};
