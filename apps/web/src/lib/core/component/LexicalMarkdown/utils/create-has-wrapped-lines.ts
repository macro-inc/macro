import { createResizeObserver } from '@solid-primitives/resize-observer';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** Track wrapping at the compact layout's width, even after the editor expands. */
export function createHasWrappedLines(
  editor: LexicalEditor,
  options: {
    container: Accessor<HTMLElement | undefined>;
    isCompact: Accessor<boolean>;
  }
) {
  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const [hasWrappedLines, setHasWrappedLines] = createSignal(false);
  let compactInset: number | undefined;
  let queued = false;
  let disposed = false;

  const measure = () => {
    const element = root();
    const container = options.container();
    if (!element?.parentElement || !container) return;
    const containerWidth = container.getBoundingClientRect().width;
    const editorWidth = element.getBoundingClientRect().width;
    if (containerWidth <= 0 || editorWidth <= 0) return;

    // Moving the buttons below the text gives it more room. Keep measuring at
    // the original inline width so a borderline draft cannot oscillate between
    // layouts. Resizing the container still changes the available typing room.
    if (options.isCompact()) compactInset = containerWidth - editorWidth;
    const width =
      containerWidth - (compactInset ?? containerWidth - editorWidth);
    if (width <= 0) return;

    const probe = element.cloneNode(true) as HTMLElement;
    probe.removeAttribute('id');
    for (const child of probe.querySelectorAll('[id]'))
      child.removeAttribute('id');
    probe.contentEditable = 'false';
    probe.inert = true;
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      width: `${width}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'visible',
    });
    element.parentElement.append(probe);
    try {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(probe);
      const lineHeight = Number.parseFloat(getComputedStyle(probe).lineHeight);
      setHasWrappedLines(range.getBoundingClientRect().height > lineHeight + 1);
    } finally {
      probe.remove();
    }
  };

  // Lexical and Solid may still be updating the DOM when a draft changes.
  // A microtask measures the committed layout, including in background tabs.
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) measure();
    });
  };

  onCleanup(
    editor.registerRootListener((element) => {
      setRoot(element);
    })
  );
  onCleanup(editor.registerUpdateListener(schedule));
  createResizeObserver(() => [root(), options.container()], schedule);
  createEffect(() => {
    options.isCompact();
    options.container();
    schedule();
  });
  createEffect(() => {
    const element = root();
    if (!element) return;
    // Mentions and other decorators can finish rendering after Lexical commits.
    const observer = new MutationObserver(schedule);
    observer.observe(element, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true,
    });
    const fonts = element.ownerDocument.fonts;
    fonts?.addEventListener('loadingdone', schedule);
    schedule();
    onCleanup(() => {
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', schedule);
    });
  });
  onCleanup(() => {
    disposed = true;
  });

  return hasWrappedLines;
}
