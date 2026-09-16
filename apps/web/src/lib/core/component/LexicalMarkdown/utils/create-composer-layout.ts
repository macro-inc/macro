import { createResizeObserver } from '@solid-primitives/resize-observer';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { createHasMultilineStructure } from './create-has-multiline-structure';

/** Auto fits the content; expanded and collapsed are host presentation overrides. */
export type ComposerLayoutMode = 'auto' | 'expanded' | 'collapsed';

/**
 * Own the layout decision and measure wrapping at the compact layout's width.
 * The container must use data-composer-compact="true"/"false" for width styles
 * so an inert copy can measure the compact layout without changing the live one.
 */
export function createComposerLayout(
  editor: LexicalEditor,
  options: {
    container: Accessor<HTMLElement | undefined>;
    mode?: Accessor<ComposerLayoutMode>;
  }
) {
  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const hasMultilineStructure = createHasMultilineStructure(editor);
  const [hasWrappedLines, setHasWrappedLines] = createSignal(false);
  const hasMultilineContent = () =>
    hasMultilineStructure() || hasWrappedLines();
  const isCompact = () =>
    match(options.mode?.() ?? 'auto')
      .with('auto', () => !hasMultilineContent())
      .with('expanded', () => false)
      .with('collapsed', () => true)
      .exhaustive();
  let queued = false;
  let disposed = false;

  const measure = () => {
    const element = root();
    const container = options.container();
    if (!element || !container?.parentElement || !container.contains(element))
      return;
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth <= 0) return;

    // Measure the actual compact CSS, including controls and padding, even if
    // this composer mounted expanded or its controls changed while expanded.
    const probe = container.cloneNode(true) as HTMLElement;
    const probeEditor = probe.querySelector<HTMLElement>(
      '[data-lexical-editor="true"]'
    );
    if (!probeEditor) return;
    probe.removeAttribute('id');
    for (const child of probe.querySelectorAll('[id]'))
      child.removeAttribute('id');
    for (const editable of probe.querySelectorAll<HTMLElement>(
      '[contenteditable]'
    ))
      editable.contentEditable = 'false';
    probe.inert = true;
    probe.setAttribute('aria-hidden', 'true');
    probe.setAttribute('data-composer-compact', 'true');
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      top: '0',
      left: '0',
      boxSizing: 'border-box',
      width: `${containerWidth}px`,
      height: 'auto',
      minHeight: '0',
      maxHeight: 'none',
      overflow: 'hidden',
    });
    container.parentElement.append(probe);
    try {
      if (probeEditor.getBoundingClientRect().width <= 0) return;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(probeEditor);
      const lineHeight = Number.parseFloat(
        getComputedStyle(probeEditor).lineHeight
      );
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
    isCompact();
    options.container();
    schedule();
  });
  createEffect(() => {
    const element = root();
    const container = options.container();
    if (!element || !container) return;
    // Decorators can finish rendering after Lexical commits; controls can also
    // change the available inline width without resizing the expanded editor.
    const observer = new MutationObserver(schedule);
    observer.observe(container, {
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

  return { isCompact, hasMultilineContent };
}
