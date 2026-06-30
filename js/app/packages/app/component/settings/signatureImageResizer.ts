import Quill, { type Parchment } from 'quill';

const MIN_WIDTH = 24;

/**
 * Adds click-to-select + drag-to-resize for images in a Quill editor: click an
 * image to show a corner handle, drag it to set the width (aspect ratio follows,
 * since only `width` is set). The width is persisted into Quill's model as the
 * <img>'s `width` attribute — which the signature sanitizer keeps — and the
 * sync fires text-change so the form marks dirty. Returns a cleanup function.
 *
 * The overlay lives in `.ql-container` (position: relative) and is repositioned
 * manually on scroll/resize/edit, since it isn't inside the scrolling editor.
 */
export function setupImageResizer(quill: Quill): () => void {
  const root = quill.root;
  const container = quill.container;

  const overlay = document.createElement('div');
  overlay.className = 'ql-image-resizer';
  const handle = document.createElement('span');
  handle.className = 'ql-image-resizer-handle';
  overlay.appendChild(handle);
  container.appendChild(overlay);

  let activeImg: HTMLImageElement | null = null;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const positionOverlay = () => {
    if (!activeImg) return;
    const img = activeImg.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    overlay.style.left = `${img.left - base.left}px`;
    overlay.style.top = `${img.top - base.top}px`;
    overlay.style.width = `${img.width}px`;
    overlay.style.height = `${img.height}px`;
  };

  const show = (img: HTMLImageElement) => {
    activeImg = img;
    overlay.style.display = 'block';
    positionOverlay();
  };

  const hide = () => {
    activeImg = null;
    overlay.style.display = 'none';
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target;
    if (target instanceof HTMLImageElement && root.contains(target)) {
      show(target);
    } else if (target instanceof Node && !overlay.contains(target)) {
      hide();
    }
  };

  // Keep the overlay aligned as content scrolls/reflows; drop it if the image
  // it tracks was deleted.
  const syncOrHide = () => {
    if (!activeImg) return;
    if (root.contains(activeImg)) positionOverlay();
    else hide();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!activeImg) return;
    e.preventDefault();
    dragging = true;
    overlay.classList.add('dragging');
    startX = e.clientX;
    startWidth = activeImg.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || !activeImg) return;
    const width = Math.round(
      Math.max(MIN_WIDTH, startWidth + e.clientX - startX)
    );
    // width only -> height auto-follows, preserving aspect ratio.
    activeImg.setAttribute('width', String(width));
    activeImg.removeAttribute('height');
    positionOverlay();
  };

  // Ends a drag from pointerup, or from pointercancel / lostpointercapture so an
  // interrupted gesture can't leave the overlay stuck in `dragging`. The current
  // width is already on the <img>, so commit it to the model either way.
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    overlay.classList.remove('dragging');
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be gone (e.g. pointercancel) — nothing to release.
    }
    if (!activeImg) return;
    const width = activeImg.getAttribute('width');
    const blot = Quill.find(activeImg) as Parchment.Blot | null;
    if (blot && width) {
      // Sync into the model so the width lands in the saved HTML and marks the
      // form dirty (formatText emits text-change).
      quill.formatText(quill.getIndex(blot), 1, 'width', width, 'user');
    }
    positionOverlay();
  };

  root.addEventListener('click', onClick);
  root.addEventListener('scroll', syncOrHide);
  window.addEventListener('resize', syncOrHide);
  quill.on('text-change', syncOrHide);
  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('scroll', syncOrHide);
    window.removeEventListener('resize', syncOrHide);
    quill.off('text-change', syncOrHide);
    overlay.remove();
  };
}
