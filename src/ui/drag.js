export class DragController {
  constructor(options) {
    this.hand = options.hand;
    this.getState = options.getState;
    this.onDrop = options.onDrop;
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

    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);

    this.active = {
      pointerId: event.pointerId,
      cardId,
      source,
      sourceRect: rect,
      ghost,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      targets,
      currentTarget: null
    };

    source.classList.add('is-drag-source');
    document.body.classList.add('is-dragging-card');
    this.markEligibleTargets(targets);
    this.moveGhost(event.clientX, event.clientY);

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  onPointerMove = (event) => {
    if (!this.active || event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    this.moveGhost(event.clientX, event.clientY);
    this.updateActiveTarget(event.clientX, event.clientY);
  };

  onPointerUp = (event) => {
    if (!this.active || event.pointerId !== this.active.pointerId) return;

    event.preventDefault();
    const targetId = this.active.currentTarget?.dataset.dropTarget ?? null;
    const active = this.active;
    const drop = targetId ? {
      id: targetId,
      position: this.getTablePosition(event.clientX, event.clientY)
    } : null;

    this.cleanupTargetClasses();

    if (drop) {
      active.ghost.classList.add('is-dropping');
      window.setTimeout(() => active.ghost.remove(), 140);
      active.source.classList.remove('is-drag-source');
      this.detachWindowEvents();
      this.active = null;
      this.onDrop(active.cardId, drop);
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
    ghost.style.transform = `translate3d(${clientX - offsetX}px, ${clientY - offsetY}px, 0) scale(1.04) rotate(-1deg)`;
  }

  updateActiveTarget(clientX, clientY) {
    const elements = document.elementsFromPoint(clientX, clientY);
    const nextTarget = elements.find((element) => {
      const target = element.dataset?.dropTarget;
      return target && this.active.targets.includes(target);
    }) ?? null;

    if (nextTarget === this.active.currentTarget) return;

    this.active.currentTarget?.classList.remove('drop-active');
    nextTarget?.classList.add('drop-active');
    this.active.currentTarget = nextTarget;
  }

  markEligibleTargets(targets) {
    for (const target of targets) {
      const element = document.querySelector(`[data-drop-target="${CSS.escape(target)}"]`);
      document.querySelectorAll(`[data-drop-target="${CSS.escape(target)}"]`).forEach((item) => {
        item.classList.add('drop-eligible');
      });
      element?.classList.add('drop-eligible');
    }
  }

  getTablePosition(clientX, clientY) {
    const table = document.querySelector('#table-drop-zone');
    const rect = table.getBoundingClientRect();
    const cardWidth = this.active.sourceRect.width;
    const cardHeight = this.active.sourceRect.height;
    const x = (clientX - rect.left - cardWidth / 2) / Math.max(1, rect.width - cardWidth);
    const y = (clientY - rect.top - cardHeight / 2) / Math.max(1, rect.height - cardHeight);

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
    const { ghost, source, sourceRect } = active;
    ghost.classList.add('is-returning');
    ghost.style.transform = `translate3d(${sourceRect.left}px, ${sourceRect.top}px, 0) scale(1)`;
    window.setTimeout(() => {
      ghost.remove();
      source.classList.remove('is-drag-source');
    }, 190);
    this.detachWindowEvents();
    this.active = null;
  }

  detachWindowEvents() {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
  }
}
