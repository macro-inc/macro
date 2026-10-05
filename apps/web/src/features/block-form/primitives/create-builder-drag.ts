import { cloneDragPreview } from '@app/components/drag-drop/drag-preview';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  type Box,
  lineForPlacement,
  lineForSectionIndex,
  type MeasuredSection,
  placementOf,
  questionDropAt,
  samePlacement,
  sectionDropAt,
  stepPlacement,
} from '../core/drop-target';
import {
  type QuestionPlacement,
  sectionInsertIndex,
} from '../core/form-layout';
import type { FormLayout } from '../core/form-model';
import type { NewSectionKind } from './create-builder';

export type DragTarget =
  | { kind: 'question'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'new-section'; id: NewSectionKind };

/** A drag in progress: what moves, where it would land, and whether it may. */
export type DragSession = {
  target: DragTarget;
  mode: 'pointer' | 'keyboard';
  /** A question's pending place. */
  placement: QuestionPlacement | undefined;
  /** A section's pending index among the others. */
  sectionIndex: number | undefined;
  /** Where to draw the drop line, in viewport coordinates. */
  lineY: number | undefined;
  /** Why it cannot land there, if it cannot. */
  refusal: string | undefined;
  /** Whether landing there changes nothing. */
  unchanged: boolean;
};

/** Mouse and pen: travel before a press becomes a drag. */
const POINTER_ACTIVATION_DISTANCE = 4;
/** Touch: a still press this long becomes a drag. */
const TOUCH_ACTIVATION_DELAY = 200;
/** Touch: moving further than this before the delay is not a press. */
const TOUCH_TOLERANCE = 8;
/** Pointer this close to the viewport's top or bottom scrolls it. */
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_MAX_STEP = 18;

export type BuilderDragOptions = {
  layout: Accessor<FormLayout | undefined>;
  viewport: Accessor<HTMLElement | undefined>;
  canvas: Accessor<HTMLElement | undefined>;
  measureQuestions: () => MeasuredSection[];
  measureSections: () => { id: string; box: Box }[];
  refusalForQuestion: (
    questionId: string,
    placement: QuestionPlacement
  ) => string | undefined;
  refusalForSection: (sectionId: string, index: number) => string | undefined;
  dropQuestion: (questionId: string, placement: QuestionPlacement) => void;
  dropSection: (sectionId: string, index: number) => void;
  /** Create only on drop; return the new section so focus follows it. */
  dropNewSection: (kind: NewSectionKind, index: number) => string | undefined;
  /** What the announcement calls a target, e.g. "question “Team”". */
  describe: (target: DragTarget) => string;
  /** Where a placement is, read aloud. */
  describePlacement: (
    questionId: string,
    placement: QuestionPlacement
  ) => string;
  /** Focus the target's handle once the move has rendered. */
  focusHandle: (target: DragTarget) => void;
};

type Press = {
  target: DragTarget;
  handle: HTMLElement;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  touchTimer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Drag questions and sections by their handles, with a pointer (mouse, pen or
 * touch) or the keyboard. Nothing is written until the drop; Escape, losing
 * the window or the pointer, or Tab cancels. Every step is announced.
 */
export function createBuilderDrag(options: BuilderDragOptions) {
  const [session, setSession] = createSignal<DragSession>();
  const [announcement, setAnnouncement] = createSignal('');
  const [pointer, setPointer] = createSignal({ x: 0, y: 0 });
  let press: Press | undefined;
  let draggedClickTarget: HTMLElement | undefined;
  let preview:
    | { element: HTMLElement; originX: number; originY: number }
    | undefined;
  let scrollFrame: number | undefined;
  /** The body's own `user-select`, put back when a pointer drag ends. */
  let previousUserSelect: string | undefined;

  const announce = (message: string) => {
    // A repeated message is still read: clear first, then set.
    setAnnouncement('');
    queueMicrotask(() => setAnnouncement(message));
  };

  const currentPlacement = (questionId: string) => {
    const layout = options.layout();
    return layout ? placementOf(layout, questionId) : undefined;
  };

  const currentSectionIndex = (sectionId: string) =>
    options
      .layout()
      ?.sections.findIndex((section) => section.id === sectionId) ?? -1;

  /** The session for a question placed at `placement`. */
  function questionSession(
    target: DragTarget & { kind: 'question' },
    mode: DragSession['mode'],
    placement: QuestionPlacement | undefined,
    lineY: number | undefined
  ): DragSession {
    const unchanged =
      !placement || samePlacement(placement, currentPlacement(target.id));
    return {
      target,
      mode,
      placement,
      sectionIndex: undefined,
      lineY,
      refusal:
        placement && !unchanged
          ? options.refusalForQuestion(target.id, placement)
          : undefined,
      unchanged,
    };
  }

  function sectionSession(
    target: Exclude<DragTarget, { kind: 'question' }>,
    mode: DragSession['mode'],
    index: number | undefined,
    lineY: number | undefined
  ): DragSession {
    const unchanged =
      index === undefined ||
      (target.kind === 'section' && index === currentSectionIndex(target.id));
    return {
      target,
      mode,
      placement: undefined,
      sectionIndex: index,
      lineY,
      refusal:
        target.kind === 'section' && index !== undefined && !unchanged
          ? options.refusalForSection(target.id, index)
          : undefined,
      unchanged,
    };
  }

  /** Where the pointer would drop the dragged target now. */
  function locate() {
    const active = session();
    if (!active || active.mode !== 'pointer') return;
    const { x, y } = pointer();
    if (active.target.kind === 'question') {
      const drop = questionDropAt(
        y,
        options.measureQuestions(),
        active.target.id
      );
      setSession(
        questionSession(
          active.target,
          'pointer',
          drop && { sectionId: drop.sectionId, index: drop.index },
          drop?.lineY
        )
      );
      return;
    }
    const sections = options.measureSections();
    const canvas = options.canvas()?.getBoundingClientRect();
    if (active.target.kind === 'new-section') {
      const viewport = options.viewport()?.getBoundingClientRect();
      if (
        !canvas ||
        !viewport ||
        x < canvas.left ||
        x > canvas.right ||
        y < viewport.top ||
        y > viewport.bottom
      ) {
        setSession(
          sectionSession(active.target, 'pointer', undefined, undefined)
        );
        return;
      }
    }
    const drop =
      sections.length === 0 && active.target.kind === 'new-section' && canvas
        ? { index: 0, lineY: canvas.top + 8 }
        : sectionDropAt(y, sections, active.target.id);
    const layout = options.layout();
    if (active.target.kind === 'new-section' && drop && layout) {
      // Show and announce where it lands: before the booking step.
      const index = sectionInsertIndex(layout, active.target.id, drop.index);
      setSession(
        sectionSession(
          active.target,
          'pointer',
          index,
          index === drop.index
            ? drop.lineY
            : lineForSectionIndex(sections, active.target.id, index)
        )
      );
      return;
    }
    setSession(
      sectionSession(active.target, 'pointer', drop?.index, drop?.lineY)
    );
  }

  function movePreview() {
    if (!preview) return;
    const { x, y } = pointer();
    preview.element.style.transform = `translate(${x - preview.originX}px, ${y - preview.originY}px)`;
  }

  function autoScroll() {
    scrollFrame = undefined;
    const active = session();
    const viewport = options.viewport();
    if (!active || active.mode !== 'pointer' || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const top = Math.max(bounds.top, 0);
    const bottom = Math.min(bounds.bottom, window.innerHeight);
    const { y } = pointer();
    let step = 0;
    if (y < top + AUTO_SCROLL_EDGE)
      step =
        -AUTO_SCROLL_MAX_STEP * (1 - Math.max(0, y - top) / AUTO_SCROLL_EDGE);
    else if (y > bottom - AUTO_SCROLL_EDGE)
      step =
        AUTO_SCROLL_MAX_STEP * (1 - Math.max(0, bottom - y) / AUTO_SCROLL_EDGE);
    if (step !== 0) {
      const before = viewport.scrollTop;
      viewport.scrollTop = before + step;
      if (viewport.scrollTop !== before) locate();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function startPreview(handle: HTMLElement) {
    const source = handle.closest<HTMLElement>('[data-drag-source]');
    if (!source) return;
    const bounds = source.getBoundingClientRect();
    const copy = cloneDragPreview(source, 'data-drag-preview');
    copy.removeAttribute('data-drag-source');
    Object.assign(copy.style, {
      position: 'fixed',
      top: `${bounds.top}px`,
      left: `${bounds.left}px`,
      pointerEvents: 'none',
      zIndex: '9999',
    });
    document.body.append(copy);
    const { x, y } = pointer();
    preview = { element: copy, originX: x, originY: y };
  }

  function stopPointerTracking() {
    if (!press) return;
    const { handle, pointerId, touchTimer } = press;
    if (touchTimer) clearTimeout(touchTimer);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerCancel);
    handle.removeEventListener('lostpointercapture', onPointerCancel);
    if (handle.hasPointerCapture(pointerId))
      handle.releasePointerCapture(pointerId);
    press = undefined;
  }

  function end() {
    stopPointerTracking();
    preview?.element.remove();
    preview = undefined;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = undefined;
    if (previousUserSelect !== undefined) {
      document.body.style.userSelect = previousUserSelect;
      previousUserSelect = undefined;
    }
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('blur', cancelLeavingFocus);
    setSession(undefined);
  }

  function refocus(target: DragTarget) {
    // After the move renders: a question moved to another section remounts.
    setTimeout(() => options.focusHandle(target), 0);
  }

  function activatePointer() {
    if (!press) return;
    const target = press.target;
    draggedClickTarget = press.handle;
    previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('blur', cancelLeavingFocus);
    startPreview(press.handle);
    setSession(
      target.kind === 'question'
        ? questionSession(
            target,
            'pointer',
            currentPlacement(target.id),
            undefined
          )
        : sectionSession(
            target,
            'pointer',
            currentSectionIndex(target.id),
            undefined
          )
    );
    locate();
    scrollFrame = requestAnimationFrame(autoScroll);
    announce(`Picked up ${options.describe(target)}.`);
  }

  function finish() {
    const active = session();
    if (!active) return;
    const { target } = active;
    let focusTarget = target;
    const described = options.describe(target);
    if (active.refusal) {
      announce(`${active.refusal} ${described} is back in place.`);
    } else if (active.unchanged) {
      announce(`${described} stays where it was.`);
    } else if (target.kind === 'question' && active.placement) {
      options.dropQuestion(target.id, active.placement);
      announce(
        `Moved ${described} to ${options.describePlacement(target.id, active.placement)}.`
      );
    } else if (
      target.kind === 'new-section' &&
      active.sectionIndex !== undefined
    ) {
      const sectionId = options.dropNewSection(target.id, active.sectionIndex);
      if (sectionId) {
        focusTarget = { kind: 'section', id: sectionId };
        announce(`Added ${described} at position ${active.sectionIndex + 1}.`);
      }
    } else if (target.kind === 'section' && active.sectionIndex !== undefined) {
      options.dropSection(target.id, active.sectionIndex);
      announce(`Moved ${described} to position ${active.sectionIndex + 1}.`);
    }
    end();
    refocus(focusTarget);
  }

  /**
   * Abandon the drag. Escape hands focus back to the handle; Tab, a blur or a
   * lost window leaves focus wherever it is going.
   */
  function cancel(focus: 'restore' | 'leave' = 'restore') {
    const active = session();
    if (!active) {
      stopPointerTracking();
      return;
    }
    announce(
      `Move cancelled. ${options.describe(active.target)} is back in place.`
    );
    end();
    if (focus === 'restore') refocus(active.target);
  }

  const cancelLeavingFocus = () => cancel('leave');

  function onPointerMove(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    setPointer({ x: event.clientX, y: event.clientY });
    if (session()) {
      event.preventDefault();
      movePreview();
      locate();
      return;
    }
    const travelled = Math.hypot(
      event.clientX - press.startX,
      event.clientY - press.startY
    );
    if (press.pointerType === 'touch') {
      if (travelled > TOUCH_TOLERANCE) stopPointerTracking();
      return;
    }
    if (travelled > POINTER_ACTIVATION_DISTANCE) activatePointer();
  }

  function onPointerUp(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    if (session()) finish();
    else stopPointerTracking();
  }

  function onPointerCancel() {
    if (session()) cancel('leave');
    else stopPointerTracking();
  }

  function onDocumentKeyDown(event: KeyboardEvent) {
    if (session()?.mode !== 'pointer') return;
    if (event.key === 'Tab') {
      cancel('leave');
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancel('restore');
  }

  /**
   * Scroll the viewport so a keyboard drop line is in view; whether it
   * scrolled, so the caller measures the line again.
   */
  function revealLine(lineY: number | undefined): boolean {
    const viewport = options.viewport();
    if (!viewport || lineY === undefined) return false;
    const bounds = viewport.getBoundingClientRect();
    const before = viewport.scrollTop;
    if (lineY < bounds.top + AUTO_SCROLL_EDGE)
      viewport.scrollTop -= bounds.top + AUTO_SCROLL_EDGE - lineY;
    else if (lineY > bounds.bottom - AUTO_SCROLL_EDGE)
      viewport.scrollTop += lineY - (bounds.bottom - AUTO_SCROLL_EDGE);
    return viewport.scrollTop !== before;
  }

  function startKeyboard(target: DragTarget) {
    if (target.kind === 'new-section') return;
    if (target.kind === 'question') {
      const placement = currentPlacement(target.id);
      if (!placement) return;
      const lineY = lineForPlacement(
        options.measureQuestions(),
        target.id,
        placement
      );
      setSession(questionSession(target, 'keyboard', placement, lineY));
      announce(
        `Picked up ${options.describe(target)}, ${options.describePlacement(target.id, placement)}. Use the up and down arrow keys to move it, Space to drop, Escape to cancel.`
      );
      return;
    }
    const index = currentSectionIndex(target.id);
    if (index < 0) return;
    const lineY = lineForSectionIndex(
      options.measureSections(),
      target.id,
      index
    );
    setSession(sectionSession(target, 'keyboard', index, lineY));
    announce(
      `Picked up ${options.describe(target)}, position ${index + 1}. Use the up and down arrow keys to move it, Space to drop, Escape to cancel.`
    );
  }

  function stepKeyboard(direction: 'up' | 'down') {
    const active = session();
    const layout = options.layout();
    if (!active || active.mode !== 'keyboard' || !layout) return;
    if (active.target.kind === 'question') {
      const from = active.placement ?? currentPlacement(active.target.id);
      const next =
        from && stepPlacement(layout, active.target.id, from, direction);
      if (!next) {
        announce(
          `${options.describe(active.target)} can't move further ${direction}.`
        );
        return;
      }
      const measure = () =>
        lineForPlacement(options.measureQuestions(), active.target.id, next);
      const lineY = measure();
      const moved = questionSession(
        active.target,
        'keyboard',
        next,
        // A scroll moves every box: measure the line again where it now is.
        revealLine(lineY) ? measure() : lineY
      );
      setSession(moved);
      announce(
        moved.refusal ?? options.describePlacement(active.target.id, next)
      );
      return;
    }
    const count = layout.sections.length;
    const from = active.sectionIndex ?? currentSectionIndex(active.target.id);
    const next = direction === 'up' ? from - 1 : from + 1;
    if (next < 0 || next >= count) {
      announce(
        `${options.describe(active.target)} can't move further ${direction}.`
      );
      return;
    }
    const measure = () =>
      lineForSectionIndex(options.measureSections(), active.target.id, next);
    const lineY = measure();
    const moved = sectionSession(
      active.target,
      'keyboard',
      next,
      revealLine(lineY) ? measure() : lineY
    );
    setSession(moved);
    announce(moved.refusal ?? `Position ${next + 1} of ${count}`);
  }

  /** Spread onto a drag handle: a `<button>` inside the `[data-drag-source]` it moves. */
  function handleProps(target: () => DragTarget) {
    return {
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0 || session() || press) return;
        draggedClickTarget = undefined;
        const handle = event.currentTarget;
        if (!(handle instanceof HTMLElement)) return;
        // Keep the press from selecting text or starting a native drag.
        event.preventDefault();
        handle.focus({ preventScroll: true });
        setPointer({ x: event.clientX, y: event.clientY });
        press = {
          target: target(),
          handle,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          touchTimer: undefined,
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onPointerMove);
        handle.addEventListener('pointerup', onPointerUp);
        handle.addEventListener('pointercancel', onPointerCancel);
        handle.addEventListener('lostpointercapture', onPointerCancel);
        if (event.pointerType === 'touch')
          press.touchTimer = setTimeout(() => {
            if (press) press.touchTimer = undefined;
            activatePointer();
          }, TOUCH_ACTIVATION_DELAY);
      },
      onKeyDown: (event: KeyboardEvent) => {
        const active = session();
        if (!active) {
          // The rail's normal button adds on Enter/Space. The created
          // section then has the same keyboard move controls as every section.
          if (target().kind === 'new-section') return;
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            startKeyboard(target());
          }
          return;
        }
        if (active.mode !== 'keyboard') return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          stepKeyboard(event.key === 'ArrowUp' ? 'up' : 'down');
        } else if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          finish();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel('restore');
        } else if (event.key === 'Tab') {
          cancel('leave');
        }
      },
      onBlur: () => {
        if (session()?.mode === 'keyboard') cancel('leave');
      },
      onClick: (event: MouseEvent) => {
        if (event.detail > 0 && event.currentTarget === draggedClickTarget) {
          event.preventDefault();
          event.stopPropagation();
          draggedClickTarget = undefined;
        }
      },
    };
  }

  onCleanup(end);

  return {
    session,
    announcement,
    handleProps,
    cancel,
    /** Focus a handle once a move has rendered (also for menu moves). */
    refocus,
    /** Whether `target` is the one being dragged. */
    isDragging: (target: DragTarget) => {
      const active = session()?.target;
      return active?.kind === target.kind && active.id === target.id;
    },
  };
}

export type BuilderDrag = ReturnType<typeof createBuilderDrag>;
