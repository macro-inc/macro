import type { Camera, FitViewport, GraphicsEditor } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';

/** Screen pixels kept between what is being typed and the frame's edges. */
const KEEP_SHOWN_MARGIN = 16;

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
   * Pan so that `element` lies inside the frame, clear of its edges. An
   * element larger than the frame shows its end, where the typing is.
   */
  const show = (element: HTMLElement) => {
    if (!frame) return;
    const laidOut = frame.element.getBoundingClientRect();
    // An on-screen keyboard that the page is not laid out around (Safari on a
    // tablet) covers the lower part of the frame: only the visual viewport
    // says what can be seen.
    const visual = window.visualViewport;
    const room = {
      left: laidOut.left,
      top: laidOut.top,
      right: Math.min(
        laidOut.right,
        visual ? visual.offsetLeft + visual.width : Infinity
      ),
      bottom: Math.min(
        laidOut.bottom,
        visual ? visual.offsetTop + visual.height : Infinity
      ),
    };
    const box = element.getBoundingClientRect();
    const along = (start: number, end: number, from: number, to: number) => {
      const past = end - (to - KEEP_SHOWN_MARGIN);
      if (past > 0) return -past;
      const before = from + KEEP_SHOWN_MARGIN - start;
      // Never push the end out to bring the start in.
      return before > 0 ? Math.min(before, -past) : 0;
    };
    const x = along(box.left, box.right, room.left, room.right);
    const y = along(box.top, box.bottom, room.top, room.bottom);
    if (Math.abs(x) >= 1 || Math.abs(y) >= 1) editor.panBy({ x, y });
  };
  const fit = () => {
    editor.fitScene(viewport());
    fitted = { camera: editor.getCamera(), again: fit };
  };
  const fitSelection = () => {
    editor.fitSelection(viewport());
    fitted = { camera: editor.getCamera(), again: fitSelection };
  };

  return {
    viewport,
    centre,
    fit,
    fitSelection,
    /** A press on the canvas: the person has taken over from the last fit. */
    release() {
      fitted = undefined;
    },
    /**
     * Fit into `element`, which the view lays over the part of the canvas no
     * chrome covers, leaving `padding` around the content.
     *
     * The view then follows the frame. Until the person moves the canvas, the
     * last fit is redone whenever the frame changes: the chrome is measured
     * after the first paint, and a rotation changes everything. Once they
     * have, a rotation keeps what was in the middle in the middle, and chrome
     * that merely grows or shrinks moves nothing.
     */
    frameWithin(element: HTMLElement, padding: number) {
      frame = { element, padding };
      let previous: Measured | undefined;
      const observer = new ResizeObserver(() => {
        const last = previous;
        const next = measure();
        previous = next;
        if (untouched()) {
          fitted?.again();
          return;
        }
        fitted = undefined;
        if (
          last &&
          (next.hostWidth !== last.hostWidth ||
            next.hostHeight !== last.hostHeight)
        )
          editor.panBy({
            x: next.centre.x - last.centre.x,
            y: next.centre.y - last.centre.y,
          });
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
      onCleanup(() => {
        observer.disconnect();
        window.removeEventListener('scroll', stayPut);
        window.visualViewport?.removeEventListener('scroll', stayPut);
        window.visualViewport?.removeEventListener('resize', check);
        if (keepShown === check) keepShown = undefined;
      });
    },
  };
}
