export const blackMark = {
  id: 'black_mark',
  title: 'Черная метка',
  description: 'Если карта находится у соперника, она раскрыта для игрока.',
  icon: 'fa-solid fa-eye',

  apply(cardModel) {
    return { applied: true, message: 'карта раскрыта сопернику', pulseIds: [cardModel.id] };
  }
};
