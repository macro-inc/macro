import type { Camera, FitViewport, GraphicsEditor } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';

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
          !last ||
          (next.hostWidth === last.hostWidth &&
            next.hostHeight === last.hostHeight)
        )
          return;
        editor.panBy({
          x: next.centre.x - last.centre.x,
          y: next.centre.y - last.centre.y,
        });
      });
      observer.observe(element);
      onCleanup(() => {
        observer.disconnect();
        if (frame?.element === element) frame = undefined;
      });
    },
  };
}
