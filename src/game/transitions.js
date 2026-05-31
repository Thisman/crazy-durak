export const TRANSITION_TYPES = {
  HOVER_END: 'hover-end',
  CARD_PLAY: 'card-play',
  CARD_BEAT: 'card-beat',
  CARD_TAKE: 'card-take',
  CARD_DISCARD: 'card-discard',
  BATTLE_CLEAR: 'battle-clear',
  EFFECT_PULSE: 'effect-pulse',
  TABLE_GROUP_MOVE: 'table-group-move'
};

export function createTransition(type, payload = {}) {
  return {
    type,
    ...payload
  };
}

export function createCardActionTransitions(cardId, role, payload = {}) {
  const actionType = role === 'defense'
    ? TRANSITION_TYPES.CARD_BEAT
    : TRANSITION_TYPES.CARD_PLAY;

  return [
    createTransition(TRANSITION_TYPES.HOVER_END, { cardId }),
    createTransition(actionType, { cardId, role, ...payload })
  ];
}

export function createBattleClearTransition(kind, actor = null, cardIds = []) {
  const type = kind === 'take' ? TRANSITION_TYPES.CARD_TAKE : TRANSITION_TYPES.CARD_DISCARD;

  return [
    createTransition(type, { actor, cardIds }),
    createTransition(TRANSITION_TYPES.BATTLE_CLEAR, { kind, actor, cardIds })
  ];
}

export function createEffectPulseTransition(cardIds) {
  const ids = [...new Set((cardIds ?? []).filter(Boolean))];
  if (!ids.length) return null;
  return createTransition(TRANSITION_TYPES.EFFECT_PULSE, { cardIds: ids });
}

export function createTableGroupMoveTransition(groupId, position, cardIds = []) {
  return createTransition(TRANSITION_TYPES.TABLE_GROUP_MOVE, {
    groupId,
    position,
    cardIds: [...cardIds]
  });
}

export function normalizeTransitions(transitions = []) {
  return (Array.isArray(transitions) ? transitions : [transitions]).flat().filter(Boolean);
}
