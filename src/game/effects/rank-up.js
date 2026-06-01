import { RANKS, RANK_VALUE, SUIT_BY_ID } from '../cards.js';

function randomItem(items, rng) {
  return items[Math.floor(rng() * items.length)] ?? items[0];
}

function promoteCardRank(card, rng) {
  const index = RANKS.indexOf(card.rank);
  if (index < 0 || index >= RANKS.length - 1) return false;

  const nextRank = randomItem(RANKS.slice(index + 1), rng);
  card.rank = nextRank;
  card.value = RANK_VALUE[nextRank];
  card.label = `${nextRank} ${SUIT_BY_ID[card.suit]?.label ?? card.suit}`;
  return true;
}

export const rankUp = {
  id: 'rank_up',
  title: 'Перевертыш',
  description: 'При розыгрыше номинал карты повышается до случайного старшего номинала, но не выше туза.',
  icon: 'fa-solid fa-arrow-up',

  apply(cardModel, zones, context) {
    const changed = promoteCardRank(context.playedCard, context.random);
    if (!changed) return { applied: false };
    Object.assign(cardModel, {
      rank: context.playedCard.rank,
      value: context.playedCard.value,
      label: context.playedCard.label,
      nominal: context.playedCard.rank
    });
    return {
      applied: true,
      message: `номинал повысился до ${context.playedCard.rank}`,
      pulseIds: [context.playedCard.id]
    };
  }
};
