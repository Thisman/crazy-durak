const DRAG_SCALE = 1.15;
const RETURN_DURATION_MS = 180;
const RETURN_IMPACT_DURATION_MS = 280;

export class DragController {
  constructor(options) {
    this.hand = options.hand;
    this.getState = options.getState;
    this.onDrop = options.onDrop;
    this.onDragStart = options.onDragStart ?? (() => {});
    this.onDragEnd = options.onDragEnd ?? (() => {});
    this.active = null;

    this.hand.addEventListener('pointerdown', (event) => this.onPointerDown(event));
  }

  onPointerDown(event) {
    const source = event.target.closest('.hand-card');
    if (document.querySelector('.game-screen')?.classList.contains('is-locked')) return;
    if (!source || source.disabled || event.button !== 0) return;

    const state = this.getState();
    const cardId = source.dataset.cardId;
    const targets = state.legalTargets[cardId] ?? [];
    if (targets.length === 0) return;

    event.preventDefault();
    source.setPointerCapture?.(event.pointerId);

    const targetSet = new Set(targets);
    const dropTargets = this.collectDropTargets(targetSet);
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    source.classList.add('is-drag-source');

    const sourceRect = source.getBoundingClientRect();
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    document.body.append(ghost);

    this.active = {
      pointerId: event.pointerId,
      cardId,
      source,
      sourceRect,
      ghost,
      offsetX: sourceRect.width / 2,
      offsetY: sourceRect.height / 2,
      targets,
      targetSet,
      dropTargets,
      currentTarget: null,
      lastClientX: event.clientX,
      lastClientY: event.clientY
    };

    this.onDragStart({ cardId, source });
    document.body.classList.add('is-dragging-card');
    this.markEligibleTargets(dropTargets);
    this.moveGhost(event.clientX, event.clientY);

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
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

    const targetId = this.active.currentTarget?.dataset.dropTarget ?? null;
    const active = this.active;
    const drop = targetId ? {
      id: targetId,
      position: this.getTablePosition(event.clientX, event.clientY)
    } : null;

    this.cleanupTargetClasses();

    if (drop) {
      this.detachWindowEvents();
      this.active = null;
      this.onDragEnd({ cardId: active.cardId, source: active.source, dropped: true });
      const dropResult = this.onDrop(active.cardId, drop);
      Promise.resolve(dropResult).catch((error) => console.error(error));
      window.requestAnimationFrame(() => {
        active.ghost.remove();
        active.source.classList.remove('is-drag-source');
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
    const { ghost, offsetX, offsetY } = this.active;
    ghost.style.transform = `translate3d(${clientX - offsetX}px, ${clientY - offsetY}px, 0) scale(${DRAG_SCALE}) rotate(-1deg)`;
  }

  updateActiveTarget(clientX, clientY) {
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

  getTablePosition(clientX, clientY) {
    const layer = document.querySelector('#battle-row') ?? document.querySelector('#table-drop-zone');
    const rect = layer.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);

    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  }

  cleanupTargetClasses() {
    document.querySelectorAll('.drop-eligible, .drop-active').forEach((element) => {
      element.classList.remove('drop-eligible', 'drop-active');
    });
    document.body.classList.remove('is-dragging-card');
  }

  animateBack(active) {
    const { ghost, source } = active;
    const startTransform = ghost.style.transform;
    const targetRect = source.getBoundingClientRect();
    const endTransform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1) rotate(0deg)`;

    this.detachWindowEvents();
    this.active = null;
    this.onDragEnd({ cardId: active.cardId, source, dropped: false });

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
      animation.cancel();
      source.classList.add('card-return-impact');
      source.classList.remove('is-drag-source');
      ghost.remove();

      const cleanupImpact = () => source.classList.remove('card-return-impact');
      source.addEventListener('animationend', cleanupImpact, { once: true });
      window.setTimeout(cleanupImpact, RETURN_IMPACT_DURATION_MS + 60);
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
