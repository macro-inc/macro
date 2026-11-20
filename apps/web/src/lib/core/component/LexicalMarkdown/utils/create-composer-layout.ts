import { createResizeObserver } from '@solid-primitives/resize-observer';
import { $getRoot, type LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { createHasMultilineStructure } from './create-has-multiline-structure';

/** Auto fits the content; expanded and collapsed are host presentation overrides. */
export type ComposerLayoutMode = 'auto' | 'expanded' | 'collapsed';

/** Subpixel slack before a width comparison decides without the probe. */
const WIDTH_TOLERANCE_PX = 1;
/** Slack when the line holds mentions or other non-text inline boxes. */
const INLINE_BOX_TOLERANCE_PX = 8;
/** Characters compared to check that both layouts set the text alike. */
const SAMPLE_LENGTH = 8;

/** The compact line's room, from the last probe, and what it depends on. */
type CompactRoom = {
  containerWidth: number;
  font: string;
  lineInsets: string;
  width: number;
};

/** What a probe of the compact layout found. */
type ProbeResult = { wraps: boolean; room?: CompactRoom };

/** Width of a block's content box: the room its lines have. */
function contentWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  const px = (value: string) => Number.parseFloat(value) || 0;
  return (
    element.getBoundingClientRect().width -
    px(style.paddingLeft) -
    px(style.paddingRight) -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth)
  );
}

/** The paragraph's own inline insets, such as an indent, which narrow its room. */
function lineInsets(line: HTMLElement) {
  const style = getComputedStyle(line);
  return [
    style.paddingInlineStart,
    style.paddingInlineEnd,
    style.marginInlineStart,
    style.marginInlineEnd,
    style.borderInlineStartWidth,
    style.borderInlineEndWidth,
    style.textIndent,
  ].join(' ');
}

function lineHeightOf(element: HTMLElement) {
  return Number.parseFloat(getComputedStyle(element).lineHeight);
}

/** Whether the editor's content takes more than one line. */
function takesSeveralLines(editorElement: HTMLElement, lineHeight: number) {
  const range = editorElement.ownerDocument.createRange();
  range.selectNodeContents(editorElement);
  return range.getBoundingClientRect().height > lineHeight + 1;
}

/** Width of the draft's first characters, when they sit on one line. */
function sampleWidth(editorElement: HTMLElement, lineHeight: number) {
  const walker = editorElement.ownerDocument.createTreeWalker(
    editorElement,
    NodeFilter.SHOW_TEXT
  );
  const first = walker.nextNode();
  if (!first?.textContent) return undefined;
  const range = editorElement.ownerDocument.createRange();
  range.setStart(first, 0);
  range.setEnd(first, Math.min(first.textContent.length, SAMPLE_LENGTH));
  const rect = range.getBoundingClientRect();
  return rect.height > lineHeight + 1 ? undefined : rect.width;
}

/**
 * Width of the draft up to its last non-space character: the spaces that end
 * it can hang, and may sit in a text node of their own (after a mention or
 * differently formatted text).
 */
function widthWithoutTrailingSpace(line: HTMLElement) {
  const walker = line.ownerDocument.createTreeWalker(
    line,
    NodeFilter.SHOW_TEXT
  );
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.textContent?.trim()) last = node;
  if (!last?.textContent) return undefined;
  const range = line.ownerDocument.createRange();
  range.setStart(line, 0);
  range.setEnd(last, last.textContent.trimEnd().length);
  return range.getBoundingClientRect().width;
}

/**
 * Inline content not made of text, such as mentions: its width can follow
 * the line's, and its margins fall outside the text's range.
 */
function inlineBoxes(line: HTMLElement) {
  return line.querySelectorAll<HTMLElement>('[contenteditable="false"]');
}

/**
 * Lay out an inert copy of the container in its compact layout and test
 * whether the draft wraps there. Costs a clone, its style and its layout, so
 * it runs only when the live layout cannot answer.
 */
function probeCompactLayout(
  container: HTMLElement,
  parent: HTMLElement,
  liveEditor: HTMLElement,
  containerWidth: number,
  lineHeight: number
): ProbeResult | undefined {
  // Measure the actual compact CSS, including controls and padding, even if
  // this composer mounted expanded or its controls changed while expanded.
  const probe = container.cloneNode(true) as HTMLElement;
  const probeEditor = probe.querySelector<HTMLElement>(
    '[data-lexical-editor="true"]'
  );
  if (!probeEditor) return undefined;
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
  parent.append(probe);
  try {
    if (probeEditor.getBoundingClientRect().width <= 0) return undefined;
    const wraps = takesSeveralLines(probeEditor, lineHeight);
    // Keep the compact line's room for the keystrokes that follow, but only
    // when the copy sets the text exactly as the live editor does: then the
    // live line's width can be compared with it directly.
    const line = probeEditor.firstElementChild;
    const probeSample = sampleWidth(probeEditor, lineHeight);
    const liveSample = sampleWidth(liveEditor, lineHeight);
    const sameText =
      probeSample !== undefined &&
      liveSample !== undefined &&
      Math.abs(probeSample - liveSample) < 0.5;
    const room =
      sameText && line instanceof HTMLElement
        ? {
            containerWidth,
            font: getComputedStyle(liveEditor).font,
            lineInsets: lineInsets(line),
            width: contentWidth(line),
          }
        : undefined;
    return { wraps, room };
  } finally {
    probe.remove();
  }
}

/**
 * Own the layout decision and measure wrapping at the compact layout's width.
 * The container must use data-composer-compact="true"/"false" for width styles
 * so an inert copy can measure the compact layout without changing the live one.
 * The compact layout must never give the text more inline room than the
 * expanded one (text that wraps expanded wraps compact), and both set it at
 * the same line height.
 *
 * Most updates need no copy: caret moves are skipped, the compact layout reads
 * its own lines, and a one-line expanded draft is compared with the compact
 * line's room from the last copy. A copy confirms every switch between the
 * layouts, and supplies that room again when anything outside the draft changes.
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
  let resizeFrame: number | undefined;
  // The compact line's room, keyed by the container's width, the editor's
  // font and the paragraph's insets (an indent). Anything else outside the draft (controls, the layout attribute,
  // loaded fonts) can change it too, so each of those drops it.
  let compactRoom: CompactRoom | undefined;
  let observer: MutationObserver | undefined;
  const noteMutations = (records: MutationRecord[]) => {
    const element = root();
    if (
      records.some(
        (record) =>
          !element ||
          !element.contains(record.target) ||
          (record.target === element && record.type === 'attributes')
      )
    )
      compactRoom = undefined;
  };

  /**
   * Whether the expanded layout's one-line draft fits the compact line, from
   * widths alone; undefined when only a probe can tell.
   */
  const fitsCompactRoom = (element: HTMLElement, containerWidth: number) => {
    const line = element.firstElementChild;
    if (
      !(line instanceof HTMLElement) ||
      compactRoom?.containerWidth !== containerWidth ||
      compactRoom.font !== getComputedStyle(element).font ||
      compactRoom.lineInsets !== lineInsets(line)
    )
      return undefined;
    const room = compactRoom.width;
    // The paragraph's contents, not the paragraph: its box spans the line.
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(line);
    const width = range.getBoundingClientRect().width;
    const boxes = inlineBoxes(line);
    const tolerance =
      boxes.length > 0 ? INLINE_BOX_TOLERANCE_PX : WIDTH_TOLERANCE_PX;
    if (width <= room - tolerance) return true;
    // A mention near the compact line's width may shrink to fit it there
    // instead of wrapping, so only a copy can tell.
    for (const box of boxes)
      if (box.getBoundingClientRect().width >= room - tolerance)
        return undefined;
    // Trailing spaces may hang past the end of the line instead of wrapping.
    const trimmed = widthWithoutTrailingSpace(line);
    if (trimmed === undefined) return undefined;
    if (trimmed > room + tolerance) return false;
    return undefined;
  };

  /** The answer the live layout gives without a copy, when it has one. */
  const readLiveLayout = (
    element: HTMLElement,
    container: HTMLElement,
    containerWidth: number,
    lineHeight: number
  ) => {
    // Reading the live editor's lines reuses the layout this frame needs
    // anyway; a copy of the composer would add a second one.
    const severalLines = takesSeveralLines(element, lineHeight);
    if (container.getAttribute('data-composer-compact') === 'true')
      return severalLines;
    if (severalLines) return true;
    const fits = fitsCompactRoom(element, containerWidth);
    return fits === undefined ? undefined : !fits;
  };

  const wrapsAtCompactWidth = (
    element: HTMLElement,
    container: HTMLElement,
    parent: HTMLElement,
    containerWidth: number
  ) => {
    if (element.getBoundingClientRect().width <= 0) return undefined;
    const lineHeight = lineHeightOf(element);
    const live = readLiveLayout(element, container, containerWidth, lineHeight);
    // Keeping the layout needs no copy. Switching it does: just after a
    // switch the layout's insets can still be transitioning, and lines read
    // mid-transition would switch it straight back.
    if (live !== undefined && live === hasWrappedLines()) return live;
    const probe = probeCompactLayout(
      container,
      parent,
      element,
      containerWidth,
      lineHeight
    );
    if (!probe) return undefined;
    compactRoom = probe.room;
    return probe.wraps;
  };

  const measure = () => {
    const element = root();
    const container = options.container();
    const parent = container?.parentElement;
    if (!element || !container || !parent || !container.contains(element))
      return;
    // Mutations not yet delivered may already have changed the compact room.
    if (observer) noteMutations(observer.takeRecords());
    // An empty draft cannot wrap, and measuring on mount delays the surface's
    // first paint.
    if (
      editor.getEditorState().read(() => $getRoot().getTextContentSize() === 0)
    ) {
      setHasWrappedLines(false);
      return;
    }
    // Several blocks or a line break are multiline at any width. Hold the
    // expanded layout until a single paragraph is measured, so turning one
    // back into a paragraph never passes through the compact layout.
    if (hasMultilineStructure()) {
      setHasWrappedLines(true);
      return;
    }
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth <= 0) return;
    const wraps = wrapsAtCompactWidth(
      element,
      container,
      parent,
      containerWidth
    );
    if (wraps !== undefined) setHasWrappedLines(wraps);
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
      compactRoom = undefined;
      setRoot(element);
    })
  );
  onCleanup(
    editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Moving the caret or selecting text cannot change how the draft wraps.
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      schedule();
    })
  );
  // A wrapping change can resize the container and its scroll viewport.
  // Applying it during ResizeObserver delivery invalidates ancestors already
  // measured in that delivery. Coalesce resize work into the next frame;
  // draft edits still measure in a microtask before their first paint.
  createResizeObserver(
    () => [root(), options.container()],
    () => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        schedule();
      });
    }
  );
  createEffect(() => {
    isCompact();
    options.container();
    schedule();
  });
  createEffect(() => {
    const element = root();
    const container = options.container();
    if (!element || !container) return;
    compactRoom = undefined;
    // Decorators can finish rendering after Lexical commits; controls can also
    // change the available inline width without resizing the expanded editor.
    const containerObserver = new MutationObserver((records) => {
      noteMutations(records);
      schedule();
    });
    observer = containerObserver;
    containerObserver.observe(container, {
      childList: true,
      characterData: true,
      attributes: true,
      subtree: true,
    });
    const fonts = element.ownerDocument.fonts;
    const onFontsLoaded = () => {
      compactRoom = undefined;
      schedule();
    };
    fonts?.addEventListener('loadingdone', onFontsLoaded);
    schedule();
    onCleanup(() => {
      containerObserver.disconnect();
      if (observer === containerObserver) observer = undefined;
      fonts?.removeEventListener('loadingdone', onFontsLoaded);
    });
  });
  onCleanup(() => {
    disposed = true;
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return { isCompact, hasMultilineContent };
}
