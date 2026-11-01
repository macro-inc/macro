import { onCleanup } from 'solid-js';

const OPEN_INNER_LAYER =
  '[role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed]), [role="menu"]:not([data-closed]), [role="listbox"]:not([data-closed])';

/**
 * Escape pressed inside a same-origin frame never reaches the dialog around
 * it. `watch` a frame once it loads to pass the key on to `onEscape`, unless
 * the framed page used it for a layer of its own.
 */
export function createFrameEscape(onEscape: () => void) {
  let frameDocument: Document | undefined;
  const onFrameKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Capture the layer before its own Escape handler removes it from the DOM.
    const innerLayer = frameDocument?.querySelector(OPEN_INNER_LAYER);
    if (innerLayer) return;
    const currentDocument = frameDocument;
    queueMicrotask(() => {
      if (!event.defaultPrevented && frameDocument === currentDocument)
        onEscape();
    });
  };
  const release = () => {
    frameDocument?.removeEventListener('keydown', onFrameKey, true);
    frameDocument = undefined;
  };
  const watch = (frame: HTMLIFrameElement) => {
    release();
    frameDocument = frame.contentDocument ?? undefined;
    frameDocument?.addEventListener('keydown', onFrameKey, true);
  };
  onCleanup(release);
  return { watch, release };
}
