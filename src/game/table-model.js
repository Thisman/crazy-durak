import { isSlotDefended, slotDefenses } from './rules.js';
import { nextPlayOrder } from './turn-order.js';

export function clamp01(value, fallback = 0.5) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function normalizePosition(position, fallback = { x: 0.5, y: 0.42 }) {
  return {
    x: clamp01(position?.x, fallback.x),
    y: clamp01(position?.y, fallback.y)
  };
}

export function aiTablePosition(state) {
  const index = state.battle.length;
  const row = Math.floor(index / 4);
  const column = index % 4;
  return normalizePosition({
    x: 0.5 + (column - 1.5) * 0.14,
    y: 0.42 + row * 0.18
  });
}

export function defensePositionNear(slot) {
  return normalizePosition({
    x: (slot.attackPosition?.x ?? 0.5) + 0.035,
    y: (slot.attackPosition?.y ?? 0.42) + 0.08
  });
}

export function createBattleSlot(state, attack, position, source = 'player') {
  return {
    attack,
    defense: null,
    defenses: [],
    attackPosition: normalizePosition(position ?? (source === 'ai' ? aiTablePosition(state) : null)),
    defensePosition: null,
    defensePositions: [],
    defenseSources: [],
    attackOrder: nextPlayOrder(state),
    defenseOrder: null,
    defenseOrders: [],
    requiredDefenseCount: 1,
    source
  };
}

export function slotGroupId(slot) {
  return slot?.attack?.id ? `slot:${slot.attack.id}` : null;
}

export function playOrder(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function getSlotZModel(slot, slotIndex) {
  const defended = isSlotDefended(slot);
  const slotBaseZ = defended ? 1000 : 10000;
  const attackOrder = playOrder(slot.attackOrder, slotIndex * 20 + 1);
  const attackZIndex = slotBaseZ + attackOrder * 2;
  const defenseZIndexes = slotDefenses(slot).map((_, index) => {
    const defenseOrder = playOrder(
      slot.defenseOrders?.[index] ?? slot.defenseOrder,
      slotIndex * 20 + index + 2
    );
    return slotBaseZ + Math.max(defenseOrder * 2, attackOrder * 2 + index + 1);
  });

  return {
    groupId: slotGroupId(slot),
    isDefended: defended,
    attackZIndex,
    defenseZIndexes
  };
}

export function getTablePresentation(battle = []) {
  return battle.map((slot, index) => getSlotZModel(slot, index));
}

function positionForDefense(slot, index) {
  const attackPosition = normalizePosition(slot.attackPosition);
  return normalizePosition(
    slot.defensePositions?.[index] ?? (index === 0 ? slot.defensePosition : null),
    {
      x: attackPosition.x + 0.035 + index * 0.02,
      y: attackPosition.y + 0.08 + index * 0.02
    }
  );
}

export function getDragGroup(slot) {
  const defenses = slotDefenses(slot);
  return {
    id: slotGroupId(slot),
    cardIds: [slot.attack?.id, ...defenses.map((card) => card.id)].filter(Boolean),
    isStack: defenses.length > 0 || isSlotDefended(slot)
  };
}

export function findSlotByGroupId(state, groupId) {
  return state.battle.find((slot) => slotGroupId(slot) === groupId) ?? null;
}

export function moveTableGroup(state, groupId, position) {
  const slot = findSlotByGroupId(state, groupId);
  if (!slot) return null;

  const previousAttackPosition = normalizePosition(slot.attackPosition);
  const nextAttackPosition = normalizePosition(position, previousAttackPosition);
  const dx = nextAttackPosition.x - previousAttackPosition.x;
  const dy = nextAttackPosition.y - previousAttackPosition.y;
  const defenses = slotDefenses(slot);
  const previousDefensePositions = defenses.map((_, index) => positionForDefense(slot, index));

  slot.attackPosition = nextAttackPosition;
  slot.defensePositions = previousDefensePositions.map((previousDefensePosition) => {
    return normalizePosition({
      x: previousDefensePosition.x + dx,
      y: previousDefensePosition.y + dy
    }, previousDefensePosition);
  });
  slot.defensePosition = slot.defensePositions.at(-1) ?? null;

  return {
    groupId,
    position: { ...slot.attackPosition },
    cardIds: getDragGroup(slot).cardIds
  };
}
