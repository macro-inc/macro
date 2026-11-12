import type { EditorView } from '@macro-inc/lexical-wasm-view';

/** Measure the Source caret rectangle without reading model topology. */
function caretRect(view: EditorView, block: HTMLElement): DOMRect {
  const selection = view.root.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
  if (range) {
    const rects = range.getClientRects();
    const last = rects.item(rects.length - 1);
    if (last) return last;
    const ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === 1)
      return (ancestor as HTMLElement).getBoundingClientRect();
  }
  // The native plan already issued the collapsed caret's top-level element.
  return block.getBoundingClientRect();
}

/** Install the fixed LOW/Before role; native owns stopping types and targets. */
export function registerNativeBlockNavigation(view: EditorView): () => void {
  const port = view.port.nativeBlockNavigation;
  if (!port) {
    if (view.port.nativeEnter)
      throw new Error('Native block navigation requires matching WASM');
    // Development shim views do not install the production native dispatcher.
    return () => {};
  }
  let disposed = false;
  const stop = () => {
    if (disposed || !view.isMounted) return false;
    const plan = port.prepare();
    if (plan === 0n) return false;
    let completed = false;
    try {
      const key = port.block(plan);
      let rects: readonly [number, number, number, number, number] | undefined;
      if (key !== undefined) {
        const element = view.getElementByKey(key);
        if (element) {
          const caret = caretRect(view, element);
          const block = element.getBoundingClientRect();
          rects = [
            block.top,
            block.bottom,
            caret.top,
            caret.bottom,
            caret.height,
          ];
        }
      }
      // Teardown or a nested native operation during measurement must invalidate
      // rather than publish the earlier decision. Native revalidates it too.
      completed = true;
      if (disposed || !view.isMounted) {
        try {
          port.cancel(plan);
        } catch {
          // Native retirement may already refuse this consumed plan.
        }
        return false;
      }
      return port.complete(plan, rects);
    } catch (error) {
      if (!completed) {
        try {
          port.cancel(plan);
        } catch {
          // Preserve the original measurement/teardown cause after consumption.
        }
      }
      throw error;
    }
  };
  const up = port.register(false, stop);
  let down: (() => void) | undefined;
  try {
    down = port.register(true, stop);
  } catch (error) {
    up();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      up();
    } finally {
      down?.();
    }
  };
}
