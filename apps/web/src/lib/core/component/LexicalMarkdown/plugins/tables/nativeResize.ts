/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Zoom probing retargeted from lexical-utils/src/index.ts,
 * Lexical 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../group-b/command';

function readResize(view: EditorView, value: unknown) {
  if (!value || typeof value !== 'object') return null;
  if (
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !('axis' in value)
  )
    throw new Error('Invalid table resize snapshot');
  const generation = value.generation;
  if (value.axis === 'row') {
    if (
      !('row' in value) ||
      typeof value.row !== 'number' ||
      !('baseHeight' in value) ||
      typeof value.baseHeight !== 'number' ||
      !('revertHeight' in value) ||
      (value.revertHeight !== null && typeof value.revertHeight !== 'number')
    )
      throw new Error('Invalid row resize snapshot');
    const { row, baseHeight, revertHeight } = value;
    return {
      axis: 'row',
      key: row,
      generation,
      apply(delta: number, merge: boolean) {
        dispatchApplicationCommand(view, 'group-b.table', {
          action: 'resize-row',
          row,
          baseHeight,
          delta,
          merge,
        });
      },
      restore() {
        dispatchApplicationCommand(view, 'group-b.table', {
          action: 'restore-row',
          row,
          height: revertHeight,
        });
      },
    };
  }
  if (
    value.axis !== 'column' ||
    !('table' in value) ||
    typeof value.table !== 'number' ||
    !('column' in value) ||
    typeof value.column !== 'number' ||
    !('baseWidths' in value) ||
    !Array.isArray(value.baseWidths) ||
    !('revertWidths' in value)
  )
    throw new Error('Invalid column resize snapshot');
  const baseWidths: number[] = [];
  for (const width of value.baseWidths) {
    if (typeof width !== 'number') throw new Error('Invalid base width');
    baseWidths.push(width);
  }
  let revertWidths: (number | null)[] | null = null;
  if (Array.isArray(value.revertWidths)) {
    revertWidths = [];
    for (const width of value.revertWidths) {
      if (width !== null && typeof width !== 'number')
        throw new Error('Invalid stored width');
      revertWidths.push(width);
    }
  } else if (value.revertWidths !== null)
    throw new Error('Invalid stored widths');
  const { table, column } = value;
  return {
    axis: 'column',
    key: table,
    generation,
    apply(delta: number, merge: boolean) {
      dispatchApplicationCommand(view, 'group-b.table', {
        action: 'resize-column',
        table,
        column,
        baseWidths,
        delta,
        merge,
      });
    },
    restore() {
      dispatchApplicationCommand(view, 'group-b.table', {
        action: 'restore-columns',
        table,
        widths: revertWidths,
      });
    },
  };
}
let manualZoom: boolean | undefined;
/** Retargeted lexical-utils calculateZoomLevel, pinned v0.45.0. */
function zoomLevel(element: Element): number {
  const document = element.ownerDocument;
  if (manualZoom === undefined) {
    const probe = document.createElement('div');
    Object.assign(probe.style, {
      position: 'absolute',
      opacity: '0',
      width: '100px',
      left: '-1000px',
    });
    document.body.append(probe);
    const before = probe.getBoundingClientRect().width;
    probe.style.setProperty('zoom', '2');
    manualZoom = probe.getBoundingClientRect().width === before;
    probe.remove();
  }
  let zoom = 1;
  if (manualZoom) {
    let current: Element | null = element;
    while (current) {
      zoom *= Number(getComputedStyle(current).getPropertyValue('zoom'));
      current = current.parentElement;
    }
  }
  return zoom;
}
/** A gesture owns one snapshot query, then native updates against its frozen dimensions. */
export function createNativeTableResizer(view: EditorView) {
  let active = true;
  let cancelCurrent: (() => void) | undefined;
  return {
    start(
      cell: HTMLElement,
      edge: 'left' | 'right' | 'bottom',
      down: PointerEvent,
      captureTarget: HTMLElement
    ): boolean {
      cancelCurrent?.();
      if (
        !active ||
        !view.isMounted ||
        view.root.contentEditable !== 'true' ||
        !view.ownsEvent(cell, true)
      )
        return false;
      const key = view.keyFromDOM(cell);
      const table = cell.closest('table');
      if (key === null || !table) return false;
      const span =
        view.options.parentSpan?.span('editor.table.resize') ??
        Telemetry.span('editor.table.resize');
      let drag: ReturnType<typeof readResize>;
      const zoom = zoomLevel(cell);
      try {
        const measurements: { key: number; width: number; height: number }[] =
          [];
        for (const element of table.querySelectorAll('tr,td,th')) {
          if (!view.ownsEvent(element, true)) continue;
          const key = view.keyFromDOM(element);
          if (key === null) continue;
          const rect = element.getBoundingClientRect();
          measurements.push({ key, width: rect.width, height: rect.height });
        }
        drag = span.run(() =>
          readResize(
            view,
            queryApplication(view, 'group-b.table-resize', {
              cell: key,
              edge,
              zoom,
              measurements,
            })
          )
        );
      } catch (error) {
        span.error(error);
        span.end();
        throw error;
      }
      if (!drag) {
        span.end();
        return false;
      }
      try {
        captureTarget.setPointerCapture(down.pointerId);
      } catch {
        span.end();
        return false;
      }
      const snapshot = drag;
      const document = view.root.ownerDocument;
      const previousCursor = document.body.style.cursor;
      if (down.pointerType !== 'touch')
        document.body.style.cursor =
          snapshot.axis === 'row' ? 'row-resize' : 'col-resize';
      let frame: number | undefined;
      let delta = 0;
      let pushed = false;
      let ended = false;
      const current = () =>
        active &&
        view.isMounted &&
        view.root.contentEditable === 'true' &&
        view.mirror.keyGeneration === snapshot.generation &&
        view.node(snapshot.key) !== null;
      const apply = () => {
        frame = undefined;
        if (!current()) {
          cleanup();
          return;
        }
        span.run(() => snapshot.apply(delta, pushed));
        pushed = true;
      };
      const move = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId) return;
        event.preventDefault();
        delta =
          (snapshot.axis === 'row'
            ? event.clientY - down.clientY
            : event.clientX - down.clientX) / zoom;
        if (frame === undefined) frame = requestAnimationFrame(apply);
      };
      const blockScroll = (event: TouchEvent) => event.preventDefault();
      const cleanup = () => {
        if (ended) return;
        ended = true;
        if (frame !== undefined) cancelAnimationFrame(frame);
        releaseCommit();
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
        document.removeEventListener('keydown', onEscape);
        document.removeEventListener('touchmove', blockScroll);
        document.body.style.cursor = previousCursor;
        if (captureTarget.hasPointerCapture(down.pointerId))
          captureTarget.releasePointerCapture(down.pointerId);
        cancelCurrent = undefined;
        span.end();
      };
      const up = (event: PointerEvent) => {
        if (event.pointerId !== down.pointerId) return;
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
          apply();
        }
        cleanup();
      };
      const cancel = (event?: PointerEvent) => {
        if (event && event.pointerId !== down.pointerId) return;
        if (pushed && current()) span.run(() => snapshot.restore());
        span.event('cancel');
        cleanup();
      };
      const onEscape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        cancel();
      };
      const releaseCommit = view.onCommit(() => {
        if (!current()) cleanup();
      });
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
      document.addEventListener('keydown', onEscape);
      document.addEventListener('touchmove', blockScroll, { passive: false });
      span.setAttr('axis', snapshot.axis);
      cancelCurrent = cancel;
      return true;
    },
    dispose() {
      cancelCurrent?.();
      active = false;
    },
  };
}
