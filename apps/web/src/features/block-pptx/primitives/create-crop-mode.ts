/**
 * Crop mode (Picture Format ▸ Crop): the picture being cropped, the crop as
 * it is dragged, and the slide drawn without the picture for the stage to
 * show beneath the crop. Leaving crop mode commits the crop as one undo
 * step.
 */

import type { ShapeOutline } from '@core/pptx-engine/types';
import { type Accessor, batch, createSignal, untrack } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  type CropState,
  cropChanged,
  cropOps,
  cropState,
  NO_CROP,
} from '../core/picture';
import type { PresentationSession } from './create-presentation-session';
import type { RenderQueue } from './create-render-queue';
import type { SlideEditor } from './create-slide-editor';

interface Cropping {
  slide: number;
  shape: number;
  /** The crop when crop mode began. */
  start: CropState;
}

export interface CropModeOptions {
  engine: PresentationEngine;
  session: PresentationSession;
  editor: SlideEditor;
  queue: RenderQueue;
  canEdit: Accessor<boolean>;
  /** Pixel width the stage renders the slide at. */
  renderWidth: Accessor<number>;
  /** After leaving crop mode (focus goes back to the stage). */
  onExit?: () => void;
}

export function createCropMode(options: CropModeOptions) {
  const { engine, session, editor } = options;
  const [cropping, setCropping] = createSignal<Cropping | null>(null);
  const [state, setState] = createSignal<CropState | null>(null);
  const [backdrop, setBackdropRaw] = createSignal<ImageBitmap>();
  const setBackdrop = (next: ImageBitmap | undefined) =>
    setBackdropRaw((old) => {
      if (old && old !== next) old.close();
      return next;
    });

  /** The picture being cropped, while it is on the slide shown. */
  const shape = (): ShapeOutline | undefined => {
    const c = cropping();
    const s = session.currentSlide();
    if (!c || !s || s.id !== c.slide) return undefined;
    const found = editor.findShape(c.shape);
    return found?.kind === 'picture' ? found : undefined;
  };
  const active = () => !!shape() && !!state();
  /** The crop when crop mode began. */
  const start = () => cropping()?.start;

  let request = 0;
  async function renderBackdrop(slideIndex: number, shapeId: number) {
    const ticket = ++request;
    const width = untrack(options.renderWidth);
    if (width <= 0) return;
    try {
      const bitmap = await options.queue.urgent(() =>
        engine.renderLayer(slideIndex, width, 'without', shapeId)
      );
      if (ticket === request && cropping()) setBackdrop(bitmap);
      else bitmap.close();
    } catch {
      // Without a backdrop the stage's own render shows through.
    }
  }

  /** Enters crop mode for a picture (the selected one by default). */
  async function enter(id?: number) {
    if (!options.canEdit()) return;
    const s = session.currentSlide();
    const picture =
      id !== undefined
        ? editor.findShape(id)
        : editor.selection().find((x) => x.kind === 'picture');
    if (!s || picture?.kind !== 'picture') return;
    if (cropping()) await commit();
    editor.stopEditing();
    editor.select(picture.id);
    const begin = cropState(
      picture.w,
      picture.h,
      picture.picture?.crop ?? NO_CROP
    );
    batch(() => {
      setCropping({ slide: s.id, shape: picture.id, start: begin });
      setState(begin);
    });
    await renderBackdrop(s.index, picture.id);
  }

  /** Leaves crop mode, applying the crop when it changed. */
  async function commit() {
    const c = cropping();
    const end = state();
    const picture = shape();
    request++;
    batch(() => {
      setCropping(null);
      setState(null);
      setBackdrop(undefined);
    });
    if (c && end && picture && cropChanged(c.start, end))
      await session.apply(cropOps(c.slide, picture, c.start, end));
    options.onExit?.();
  }

  /** Leaves crop mode without changing the picture. */
  function cancel() {
    request++;
    batch(() => {
      setCropping(null);
      setState(null);
      setBackdrop(undefined);
    });
  }

  // A reloaded presentation has nothing to crop.
  session.onReplaced(cancel);

  return {
    active,
    shape,
    state,
    setState,
    start,
    backdrop,
    enter,
    commit,
    cancel,
    toggle: () => (active() ? commit() : enter()),
  };
}

export type CropMode = ReturnType<typeof createCropMode>;
