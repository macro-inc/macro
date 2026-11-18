import type { Camera, FitViewport, GraphicsEditor } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';

/** Screen pixels kept between what is being typed and the frame's edges. */
const KEEP_SHOWN_MARGIN = 16;

/**
 * Where the caret is on screen, when it is inside `element`: the end of the
 * selection that moves. A selection dragged backward has that end at the
 * start of its range, so the range's own boxes would be those of the end left
 * behind.
 */
function caretIn(element: HTMLElement) {
  const selection = document.getSelection();
  const node = selection?.focusNode;
  if (!selection || !node || !element.contains(node)) return undefined;
  const caret = document.createRange();
  caret.setStart(node, selection.focusOffset);
  caret.collapse(true);
  const rects = caret.getClientRects();
  const rect = rects[rects.length - 1] ?? caret.getBoundingClientRect();
  // An empty line reports no box at all.
  return rect.width || rect.height ? rect : undefined;
}

type Measured = {
  hostWidth: number;
  hostHeight: number;
  centre: { x: number; y: number };
};

/**
 * Where a canvas view fits and centres its content. That is the whole view,
 * unless a touch view lays a frame over the part its chrome leaves clear
 * (`frameWithin`): fits then go there, and the view follows the frame.
 */
export function createCanvasFraming(
  editor: GraphicsEditor,
  host: () => HTMLElement | undefined
) {
  let frame: { element: HTMLElement; padding: number } | undefined;
  // Brings the element being typed in back into the frame, while there is one.
  let keepShown: (() => void) | undefined;
  // The last fit, for as long as the person has not moved the canvas since.
  let fitted: { camera: Camera; again: () => void } | undefined;

  const viewport = (): FitViewport => {
    const element = host();
    const size = {
      width: element?.clientWidth ?? 0,
      height: element?.clientHeight ?? 0,
    };
    if (!element || !frame) return size;
    const outer = element.getBoundingClientRect();
    const inner = frame.element.getBoundingClientRect();
    return {
      ...size,
      inset: {
        top: inner.top - outer.top,
        left: inner.left - outer.left,
        right: outer.right - inner.right,
        bottom: outer.bottom - inner.bottom,
      },
      padding: frame.padding,
    };
  };
  /** The middle of the room content is fitted into, in the view's own pixels. */
  const centre = () => {
    const { width, height, inset } = viewport();
    const left = inset?.left ?? 0;
    const top = inset?.top ?? 0;
    return {
      x: left + (width - left - (inset?.right ?? 0)) / 2,
      y: top + (height - top - (inset?.bottom ?? 0)) / 2,
    };
  };
  const measure = (): Measured => {
    const { width, height } = viewport();
    return { hostWidth: width, hostHeight: height, centre: centre() };
  };
  const untouched = () => {
    const camera = editor.getCamera();
    return (
      fitted !== undefined &&
      camera.x === fitted.camera.x &&
      camera.y === fitted.camera.y &&
      camera.scale === fitted.camera.scale
    );
  };
  /**
   * Pan so that the text being typed in `element` can be seen. Text that fits
   * in the frame is kept whole, clear of its edges. Text larger than the
   * frame follows its caret, and is left alone while it has none: bringing its
   * end in would take the place the person tapped out of view.
   */
  const show = (element: HTMLElement) => {
    if (!frame) return;
    const laidOut = frame.element.getBoundingClientRect();
    // An on-screen keyboard that the page is not laid out around (Safari on a
    // tablet) covers the lower part of the frame: only the visual viewport
    // says what can be seen.
    const visual = window.visualViewport;
    const room = {
      left: laidOut.left + KEEP_SHOWN_MARGIN,
      top: laidOut.top + KEEP_SHOWN_MARGIN,
      right:
        Math.min(
          laidOut.right,
          visual ? visual.offsetLeft + visual.width : Infinity
        ) - KEEP_SHOWN_MARGIN,
      bottom:
        Math.min(
          laidOut.bottom,
          visual ? visual.offsetTop + visual.height : Infinity
        ) - KEEP_SHOWN_MARGIN,
    };
    const box = element.getBoundingClientRect();
    const caret = caretIn(element);
    /** How far to move a span so that it lies between `from` and `to`. */
    const into = (start: number, end: number, from: number, to: number) => {
      if (end > to) return to - end;
      return start < from ? from - start : 0;
    };
    const along = (
      [start, end]: [number, number],
      [from, to]: [number, number],
      caretSpan: [number, number] | undefined
    ) => {
      if (end - start <= to - from) return into(start, end, from, to);
      return caretSpan ? into(caretSpan[0], caretSpan[1], from, to) : 0;
    };
    const x = along(
      [box.left, box.right],
      [room.left, room.right],
      caret && [caret.left, caret.right]
    );
    const y = along(
      [box.top, box.bottom],
      [room.top, room.bottom],
      caret && [caret.top, caret.bottom]
    );
    if (Math.abs(x) >= 1 || Math.abs(y) >= 1) editor.panBy({ x, y });
  };
  // Only a fit that had something to fit is one to keep up: an empty canvas
  // must not zoom onto the first thing put on it when the chrome next moves.
  const fit = () => {
    fitted = editor.fitScene(viewport())
      ? { camera: editor.getCamera(), again: fit }
      : undefined;
  };
  const fitSelection = () => {
    fitted = editor.fitSelection(viewport())
      ? { camera: editor.getCamera(), again: fitSelection }
      : undefined;
  };

  return {
    viewport,
    centre,
    fit,
    fitSelection,
    /**
     * A press anywhere on `element`, the view's host, means the person has
     * taken over from the last fit. Heard at the window: a tool may stop the
     * press before it reaches the host.
     */
    watchPresses(element: HTMLElement) {
      const pressed = (event: PointerEvent) => {
        if (event.target instanceof Node && element.contains(event.target))
          fitted = undefined;
      };
      window.addEventListener('pointerdown', pressed, true);
      onCleanup(() => window.removeEventListener('pointerdown', pressed, true));
    },
    /**
     * Fit into `element`, which the view lays over the part of the canvas no
     * chrome covers, leaving `padding` around the content.
     *
     * The view then follows the frame. Until the person moves the canvas, the
     * last fit is redone whenever the frame changes: the chrome is measured
     * after the first paint, and a rotation changes everything. Once they
     * have, a rotation (the host changing width) keeps what was in the middle
     * in the middle. Chrome that merely grows or shrinks moves nothing, and
     * neither does a keyboard, which only makes the host shorter.
     */
    frameWithin(element: HTMLElement, padding: number) {
      frame = { element, padding };
      let previous: Measured | undefined;
      const observer = new ResizeObserver(() => {
        const last = previous;
        const next = measure();
        previous = next;
        if (untouched()) fitted?.again();
        else {
          fitted = undefined;
          if (last && next.hostWidth !== last.hostWidth)
            editor.panBy({
              x: next.centre.x - last.centre.x,
              y: next.centre.y - last.centre.y,
            });
        }
        // The keyboard takes the lower part of the view: what is being typed
        // must not end up behind it.
        keepShown?.();
      });
      observer.observe(element);
      onCleanup(() => {
        observer.disconnect();
        if (frame?.element === element) frame = undefined;
      });
    },
    /**
     * Keep `element`, the text being typed, inside the frame for as long as
     * it is mounted: when it appears, as it grows, and when the frame shrinks
     * because the keyboard came up. Without a frame the view is left alone.
     */
    keepInFrame(element: HTMLElement) {
      if (!frame) return;
      // Typing has begun: the last fit is no longer what the person wants kept.
      fitted = undefined;
      const check = () => show(element);
      keepShown = check;
      // Reports once when it starts observing, which is the first check.
      const observer = new ResizeObserver(check);
      observer.observe(element);
      // The browser scrolls the page to reveal a caret behind the keyboard,
      // which pushes the app's header off the screen. The canvas pans
      // instead, so the page goes back to where it was.
      const stayPut = () => {
        if (!window.scrollY && !window.visualViewport?.offsetTop) return;
        window.scrollTo(0, 0);
        check();
      };
      window.addEventListener('scroll', stayPut);
      window.visualViewport?.addEventListener('scroll', stayPut);
      window.visualViewport?.addEventListener('resize', check);
      // The caret also moves without the text changing size.
      document.addEventListener('selectionchange', check);
      onCleanup(() => {
        observer.disconnect();
        document.removeEventListener('selectionchange', check);
        window.removeEventListener('scroll', stayPut);
        window.visualViewport?.removeEventListener('scroll', stayPut);
        window.visualViewport?.removeEventListener('resize', check);
        if (keepShown === check) keepShown = undefined;
      });
    },
  };
}
