import { usePageVisibility } from '@solid-primitives/page-visibility';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { $getRoot, type LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
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
  const visible = usePageVisibility();
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
  let disposed = false;
  let frame: number | undefined;

  const measure = () => {
    const element = root();
    const container = options.container();
    if (!element || !container?.parentElement || !container.contains(element))
      return;
    // An empty draft cannot wrap. The probe below clones the composer into the
    // page and forces a layout, which on mount delays the surface's first paint.
    if (
      editor.getEditorState().read(() => $getRoot().getTextContentSize() === 0)
    ) {
      setHasWrappedLines(false);
      return;
    }
    const measureRange = (editorElement: HTMLElement) => {
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(editorElement);
      const lineHeight = Number.parseFloat(
        getComputedStyle(editorElement).lineHeight
      );
      setHasWrappedLines(range.getBoundingClientRect().height > lineHeight + 1);
    };
    // The live editor already has the compact CSS. Read it directly without
    // inserting another composer and invalidating the page's layout.
    if (container.getAttribute('data-composer-compact') === 'true') {
      measureRange(element);
      return;
    }
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
      measureRange(probeEditor);
    } finally {
      probe.remove();
    }
  };

  // Lexical, Solid, decorators and controls can all change in one edit.
  // Read their final DOM once before paint, outside the input dispatch and
  // ResizeObserver delivery. Hidden pages resume measurement when revealed.
  const schedule = () => {
    if (frame !== undefined || disposed || !visible()) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!disposed && visible()) measure();
    });
  };
  createEffect(
    on(visible, (isVisible) => {
      if (isVisible) schedule();
      else if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    })
  );

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
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  return { isCompact, hasMultilineContent };
}
