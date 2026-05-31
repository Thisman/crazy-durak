const DRAG_SCALE = 1.15;
const RETURN_DURATION_MS = 180;
const RETURN_IMPACT_DURATION_MS = 280;

export class DragController {
  constructor(options) {
    this.hand = options.hand;
    this.table = options.table ?? document.querySelector('#battle-row');
    this.getState = options.getState;
    this.onDrop = options.onDrop;
    this.onMoveTableGroup = options.onMoveTableGroup ?? (() => false);
    this.onDragStart = options.onDragStart ?? (() => {});
    this.onDragEnd = options.onDragEnd ?? (() => {});
    this.active = null;

    this.hand.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.table?.addEventListener('pointerdown', (event) => this.onPointerDown(event));
  }

  onPointerDown(event) {
    const source = event.target.closest('[data-draggable="true"][data-card-id]');
    if (document.querySelector('.game-screen')?.classList.contains('is-locked')) return;
    if (!source || event.button !== 0) return;

    const kind = source.dataset.dragKind ?? (source.classList.contains('hand-card') ? 'hand' : 'table');
    if (kind === 'hand' && source.disabled) return;

    const state = this.getState();
    const cardId = source.dataset.cardId;
    const targets = kind === 'hand' ? (state.legalTargets[cardId] ?? []) : [];
    if (kind === 'hand' && targets.length === 0) return;
    if (kind === 'table' && !source.dataset.dragGroupId) return;

    event.preventDefault();
    source.setPointerCapture?.(event.pointerId);

    const targetSet = new Set(targets);
    const dropTargets = kind === 'hand' ? this.collectDropTargets(targetSet) : [];
    const { ghost, sourceRect, hiddenSources } = this.createGhost(source, kind);

    const offsetX = kind === 'table' ? event.clientX - sourceRect.left : sourceRect.width / 2;
    const offsetY = kind === 'table' ? event.clientY - sourceRect.top : sourceRect.height / 2;
    const initScale = DRAG_SCALE;
    const initRotation = kind === 'table' ? '0deg' : '-1deg';
    ghost.style.transform = `translate3d(${event.clientX - offsetX}px, ${event.clientY - offsetY}px, 0) scale(${initScale}) rotate(${initRotation})`;

    hiddenSources.forEach((item) => item.classList.add('is-drag-source'));
    document.body.append(ghost);

    this.active = {
      pointerId: event.pointerId,
      kind,
      cardId,
      groupId: source.dataset.dragGroupId ?? null,
      source,
      sourceRect,
      hiddenSources,
      ghost,
      offsetX,
      offsetY,
      targets,
      targetSet,
      dropTargets,
      currentTarget: null,
      lastClientX: event.clientX,
      lastClientY: event.clientY
    };

    this.onDragStart({ cardId, source, kind, groupId: this.active.groupId });
    document.body.classList.add('is-dragging-card');
    this.markEligibleTargets(dropTargets);

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  createGhost(source, kind) {
    if (kind === 'table') {
      const slot = source.closest('.battle-slot') ?? source;
      const sourceRect = slot.getBoundingClientRect();
      const ghost = slot.cloneNode(true);
      ghost.classList.add('drag-ghost', 'table-drag-ghost');
      ghost.style.left = '0';
      ghost.style.top = '0';
      ghost.style.width = `${sourceRect.width}px`;
      ghost.style.height = `${sourceRect.height}px`;
      ghost.querySelectorAll('[data-drop-target]').forEach((item) => item.removeAttribute('data-drop-target'));
      ghost.querySelectorAll('.effect-trigger').forEach((item) => item.classList.remove('effect-trigger'));
      return { ghost, sourceRect, hiddenSources: [slot] };
    }

    const sourceRect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    ghost.classList.remove('effect-trigger');
    return { ghost, sourceRect, hiddenSources: [source] };
  }

  onPointerMove = (event) => {
    if (!this.active || event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    this.active.lastClientX = event.clientX;
    this.active.lastClientY = event.clientY;

    if (this.active.moveFrame) return;

    this.active.moveFrame = window.requestAnimationFrame(() => {
      if (!this.active) return;
      this.active.moveFrame = 0;
      this.moveGhost(this.active.lastClientX, this.active.lastClientY);
      this.updateActiveTarget(this.active.lastClientX, this.active.lastClientY);
    });
  };

  onPointerUp = (event) => {
    if (!this.active || event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    if (this.active.moveFrame) {
      window.cancelAnimationFrame(this.active.moveFrame);
      this.active.moveFrame = 0;
    }
    this.moveGhost(event.clientX, event.clientY);
    this.updateActiveTarget(event.clientX, event.clientY);

    const active = this.active;
    const position = this.getTablePosition(event.clientX, event.clientY);
    const targetId = active.currentTarget?.dataset.dropTarget ?? null;
    const drop = targetId ? { id: targetId, position } : null;
    const tableMove = active.kind === 'table' && this.isSlotPositionValid(event.clientX, event.clientY, active.sourceRect)
      ? { groupId: active.groupId, position }
      : null;

    this.cleanupTargetClasses();

    if (drop || tableMove) {
      this.detachWindowEvents();
      this.active = null;
      this.onDragEnd({
        cardId: active.cardId,
        source: active.source,
        kind: active.kind,
        groupId: active.groupId,
        dropped: true
      });
      const dropResult = drop
        ? this.onDrop(active.cardId, drop)
        : this.onMoveTableGroup(tableMove.groupId, tableMove.position);
      Promise.resolve(dropResult).catch((error) => console.error(error));
      window.requestAnimationFrame(() => {
        active.ghost.remove();
        this.restoreSources(active);
      });
      return;
    }

    this.animateBack(active);
  };

  onPointerCancel = () => {
    if (!this.active) return;
    this.cleanupTargetClasses();
    this.animateBack(this.active);
  };

  moveGhost(clientX, clientY) {
    const { ghost, offsetX, offsetY, kind } = this.active;
    const scale = DRAG_SCALE;
    const rotation = kind === 'table' ? '0deg' : '-1deg';
    ghost.style.transform = `translate3d(${clientX - offsetX}px, ${clientY - offsetY}px, 0) scale(${scale}) rotate(${rotation})`;
  }

  updateActiveTarget(clientX, clientY) {
    if (this.active.kind === 'table') return;

    const target = this.active.dropTargets.find((item) => (
      clientX >= item.rect.left
        && clientX <= item.rect.right
        && clientY >= item.rect.top
        && clientY <= item.rect.bottom
    ));
    const nextTarget = target?.element ?? null;

    if (nextTarget === this.active.currentTarget) return;

    this.active.currentTarget?.classList.remove('drop-active');
    nextTarget?.classList.add('drop-active');
    this.active.currentTarget = nextTarget;
  }

  collectDropTargets(targetSet) {
    const uniqueElements = new Set();

    for (const target of targetSet) {
      const selector = `[data-drop-target="${CSS.escape(target)}"]`;
      const elements = [...document.querySelectorAll(selector)];
      const hasBattleSlot = elements.some((element) => element.classList.contains('battle-slot'));

      elements.forEach((element) => {
        if (hasBattleSlot && element.classList.contains('table-card')) return;
        uniqueElements.add(element);
      });
    }

    return [...uniqueElements]
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        priority: this.getTargetPriority(element)
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  getTargetPriority(element) {
    if (element.classList.contains('battle-slot')) return 30;
    if (element.classList.contains('table-card')) return 20;
    return 10;
  }

  markEligibleTargets(dropTargets) {
    for (const { element } of dropTargets) {
      element.classList.add('drop-eligible');
    }
  }

  getTableLayer() {
    return document.querySelector('#battle-row') ?? document.querySelector('#table-drop-zone');
  }

  getTablePosition(clientX, clientY) {
    const layer = this.getTableLayer();
    const rect = layer.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);

    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  }

  isTablePoint(clientX, clientY) {
    const rect = this.getTableLayer().getBoundingClientRect();
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  isSlotPositionValid(clientX, clientY, sourceRect) {
    const layerRect = this.getTableLayer().getBoundingClientRect();
    const halfW = sourceRect.width / 2;
    const halfH = sourceRect.height / 2;
    return clientX - halfW >= layerRect.left
      && clientX + halfW <= layerRect.right
      && clientY - halfH >= layerRect.top
      && clientY + halfH <= layerRect.bottom;
  }

  cleanupTargetClasses() {
    document.querySelectorAll('.drop-eligible, .drop-active').forEach((element) => {
      element.classList.remove('drop-eligible', 'drop-active');
    });
    document.body.classList.remove('is-dragging-card');
  }

  restoreSources(active) {
    active.hiddenSources?.forEach((source) => source.classList.remove('is-drag-source'));
  }

  animateBack(active) {
    const { ghost, source, kind } = active;
    const startTransform = ghost.style.transform;
    const targetRect = kind === 'table' ? active.sourceRect : source.getBoundingClientRect();
    const endTransform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1) rotate(0deg)`;

    this.detachWindowEvents();
    this.active = null;
    this.onDragEnd({
      cardId: active.cardId,
      source,
      kind,
      groupId: active.groupId,
      dropped: false
    });

    ghost.classList.add('is-returning');
    ghost.style.transition = 'none';
    ghost.style.transform = startTransform;

    const animation = ghost.animate([
      { transform: startTransform, opacity: 0.98 },
      { transform: endTransform, opacity: 0.98 }
    ], {
      duration: RETURN_DURATION_MS,
      easing: 'cubic-bezier(.18, .9, .24, 1)',
      fill: 'forwards'
    });

    animation.finished.catch(() => {}).then(() => {
      if (kind === 'hand') {
        source.classList.add('card-return-impact');
        const cleanupImpact = () => source.classList.remove('card-return-impact');
        source.addEventListener('animationend', cleanupImpact, { once: true });
        window.setTimeout(cleanupImpact, RETURN_IMPACT_DURATION_MS + 60);
      }
      this.restoreSources(active);
      ghost.remove();
    });
  }

  detachWindowEvents() {
    if (this.active?.moveFrame) {
      window.cancelAnimationFrame(this.active.moveFrame);
      this.active.moveFrame = 0;
    }
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
  }
}
