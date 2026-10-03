/**
 * The worker-backed `PresentationEngine`: the Rust engine compiled to wasm,
 * running in the shared PPTX worker (`@core/pptx-engine/client`).
 */

import {
  applyEdits,
  breakEditGroup,
  closePresentation,
  getOutline,
  getSlideOutline,
  getTextLayout,
  openPresentation,
  redoEdit,
  renderSlide,
  renderSlideLayer,
  savePresentation,
  undoEdit,
} from '@core/pptx-engine/client';
import type { PresentationEngine } from '../context/pptx-editor-context';

let nextKey = 0;

/**
 * Opens `bytes` (transferred to the worker) and returns the engine for it.
 * Rejects when the file is not a readable presentation.
 */
export async function openWorkerPresentation(
  bytes: ArrayBuffer
): Promise<PresentationEngine> {
  const key = `pptx-${Date.now().toString(36)}-${nextKey++}`;
  await openPresentation(key, bytes);
  return {
    outline: () => getOutline(key),
    slideOutline: (index) => getSlideOutline(key, index),
    render: (index, width) => renderSlide(key, index, width),
    renderLayer: (index, width, mode, shape) =>
      renderSlideLayer(key, index, width, mode, shape),
    textLayout: (index, shape) => getTextLayout(key, index, shape),
    apply: (ops, group) => applyEdits(key, ops, group),
    breakGroup: () => breakEditGroup(key),
    undo: () => undoEdit(key),
    redo: () => redoEdit(key),
    save: () => savePresentation(key),
    close: () => closePresentation(key),
  };
}
