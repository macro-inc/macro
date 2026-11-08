import type { EditorView } from '@macro-inc/lexical-wasm-view';

// Match tableTouchSelection: scrolling wins until a stationary 400 ms press.
const LONG_PRESS_MS = 400;
const SLOP_PX = 10;

export function registerNativeTableTouchSelection(
  view: EditorView
): () => void {
  const document = view.root.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error('Table selection requires a window');
  let endGesture: (() => void) | undefined;
  let armed = false;
  const down = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      !event.isPrimary ||
      view.root.contentEditable !== 'true' ||
      !view.ownsEvent(event.target, true)
    )
      return;
    endGesture?.();
    const cell =
      event.target instanceof Element ? event.target.closest('td,th') : null;
    const table = cell?.closest('table');
    const anchor = cell ? view.keyFromDOM(cell) : null;
    const tableKey = table ? view.keyFromDOM(table) : null;
    if (!cell || !table || anchor === null || tableKey === null) return;
    const generation = view.mirror.keyGeneration;
    const previousSelect = table.style.getPropertyValue('-webkit-user-select');
    const previousCallout = table.style.getPropertyValue(
      '-webkit-touch-callout'
    );
    let selecting = false;
    let focus = anchor;
    const valid = () =>
      view.isMounted &&
      view.root.contentEditable === 'true' &&
      view.mirror.keyGeneration === generation &&
      view.node(anchor) !== null &&
      table.isConnected;
    const submit = (key: number) =>
      view.port.selectionFromView({
        kind: 'table',
        table: tableKey,
        anchorCell: anchor,
        focusCell: key,
      });
    const blockScroll = (event: TouchEvent) => {
      if (selecting) event.preventDefault();
    };
    const end = () => {
      window.clearTimeout(timer);
      releaseCommit();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', blockScroll);
      if (selecting) {
        table.style.setProperty('-webkit-user-select', previousSelect);
        table.style.setProperty('-webkit-touch-callout', previousCallout);
      }
      armed = false;
      endGesture = undefined;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === downId) end();
    };
    const { pointerId: downId, clientX: startX, clientY: startY } = event;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== downId) return;
      if (!valid()) {
        end();
        return;
      }
      if (!selecting) {
        if (
          Math.hypot(event.clientX - startX, event.clientY - startY) > SLOP_PX
        )
          end();
        return;
      }
      for (const element of document.elementsFromPoint(
        event.clientX,
        event.clientY
      )) {
        const next = element.closest('td,th');
        if (
          !next ||
          next.closest('table') !== table ||
          !view.ownsEvent(next, true)
        )
          continue;
        const key = view.keyFromDOM(next);
        if (key !== null && key !== focus) {
          focus = key;
          submit(key);
        }
        break;
      }
    };
    const timer = window.setTimeout(() => {
      if (!valid()) {
        end();
        return;
      }
      selecting = true;
      table.style.setProperty('-webkit-user-select', 'none');
      table.style.setProperty('-webkit-touch-callout', 'none');
      window.navigator.vibrate?.(10);
      submit(anchor);
    }, LONG_PRESS_MS);
    const releaseCommit = view.onCommit(() => {
      if (!valid()) end();
    });
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.addEventListener('touchmove', blockScroll, { passive: false });
    armed = true;
    endGesture = end;
  };
  const context = (event: Event) => {
    if (armed) event.preventDefault();
  };
  view.root.addEventListener('pointerdown', down);
  view.root.addEventListener('contextmenu', context);
  return () => {
    endGesture?.();
    view.root.removeEventListener('pointerdown', down);
    view.root.removeEventListener('contextmenu', context);
  };
}
