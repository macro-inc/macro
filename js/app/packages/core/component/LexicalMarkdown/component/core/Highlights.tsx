import { createDOMRange } from '@lexical/selection';
import type { NodeIdMappings } from '@lexical-core';
import {
  $getNodeByKey,
  $isRangeSelection,
  type BaseSelection,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MarkdownStackingContext } from '../../constants';
import type {
  EphemeralLocation,
  MarkdownLocation,
  PersistentLocation,
} from '../../plugins/location/locationPlugin';
import {
  autoRegister,
  lazyRegister,
  registerEditorWidthObserver,
  registerInternalLayoutShiftListener,
  registerMutationListener,
} from '../../plugins/shared/utils';

type PaddingValue =
  | number
  | [number, number]
  | [number, number, number, number];

/**
 * Convert a DOMRect to a CSS style object.
 * @param targetRect The DOMRect to convert
 * @param anchorElem The container anchor parent.
 * @param padding The padding to add to the rect:
 *   - number: uniform padding on all sides
 *   - [x, y]: horizontal and vertical padding
 *   - [top, right, bottom, left]: individual side padding (CSS-style)
 */
export function getHighlightStyle(
  targetRect: DOMRect | null,
  anchorElem: HTMLElement,
  padding: PaddingValue = 0
): JSX.CSSProperties {
  let paddingTop: number,
    paddingRight: number,
    paddingBottom: number,
    paddingLeft: number;
  if (typeof padding === 'number') {
    paddingTop = paddingRight = paddingBottom = paddingLeft = padding;
  } else if (padding.length === 2) {
    paddingLeft = paddingRight = padding[0];
    paddingTop = paddingBottom = padding[1];
  } else if (padding.length === 4) {
    [paddingTop, paddingRight, paddingBottom, paddingLeft] = padding;
  } else {
    console.error('Invalid padding format');
    paddingTop = paddingRight = paddingBottom = paddingLeft = 0;
  }

  const anchorParent = anchorElem.parentElement;
  if (targetRect === null || !anchorParent) {
    return {
      transform: 'translate(-10000px, -10000px)',
      width: '0',
      height: '0',
    };
  }
  const anchorElementRect = anchorElem.getBoundingClientRect();

  const top = targetRect.top - anchorElementRect.top - paddingTop;
  const left = targetRect.left - anchorElementRect.left - paddingLeft;
  const width = targetRect.width + paddingLeft + paddingRight;
  const height = targetRect.height + paddingTop + paddingBottom;

  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${left}px, ${top}px)`,
  };
}

/**
 * Return the enclosing rectangle of a set of rectangles.
 * @param rects
 */
function boundingRect(rects: DOMRect[]) {
  if (rects.length === 0) {
    return new DOMRect(0, 0, 0, 0);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.left);
    minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.right);
    maxY = Math.max(maxY, rect.bottom);
  }
  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

function getUniqueRects(rects: DOMRect[]): DOMRect[] {
  const uniqueRects: DOMRect[] = [];
  const seen = new Set<string>();
  for (const rect of rects) {
    const key = `${rect.x},${rect.y},${rect.width},${rect.height} `;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRects.push(rect);
    }
  }
  return uniqueRects;
}

/**
 * A fork of the Lexical util by the same name. This function does a bit more computation
 * to get fewer and better fit rectangles.
 * @param range The DOM range to get rectangles from
 * @param overlapMargin Vertical margin to determine if rects are on the same line
 * @returns Array of DOM rectangles representing the selection
 */
function createRectsFromDOMRange(
  range: Range,
  overlapMargin = 10,
  rootWidth?: number
): DOMRect[] {
  // Sort by height then width so we can merge rects by line.
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width * r.height > 0)
    .sort((a, b) => {
      const top = a.top - b.top;
      if (Math.abs(top) < overlapMargin) {
        return a.left - b.left;
      }
      return top;
    });

  if (rects.length === 0) return [];

  const lines: DOMRect[][] = [];
  let currentLine: DOMRect[] = [rects[0]];

  for (let i = 1; i < rects.length; i++) {
    const current = rects[i];
    const prevRect = currentLine[currentLine.length - 1];

    const sameLine = Math.abs(current.top - prevRect.top) < overlapMargin;

    if (sameLine) {
      currentLine.push(current);
    } else {
      lines.push(currentLine);
      currentLine = [current];
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  const outRects: DOMRect[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = getUniqueRects(lines[i]);
    if (line.length === 1) {
      let rect = line[0];
      // TODO: This filters out full spanning empty lines. But will also filter out
      // snapping with elements like images or tables.
      if (rootWidth && rect.width < rootWidth) {
        outRects.push(rect);
      }
    } else {
      const { minLeft, maxRight, minTop, maxBottom } = line.reduce(
        (acc, rect) => ({
          minLeft: Math.min(acc.minLeft, rect.left),
          maxRight: Math.max(acc.maxRight, rect.right),
          minTop: Math.min(acc.minTop, rect.top),
          maxBottom: Math.max(acc.maxBottom, rect.bottom),
        }),
        {
          minLeft: Infinity,
          maxRight: -Infinity,
          minTop: Infinity,
          maxBottom: -Infinity,
        }
      );

      const innerRects = line.filter((rect) => {
        const isMaximalRect =
          rect.left === minLeft &&
          rect.right === maxRight &&
          rect.top === minTop &&
          rect.bottom === maxBottom;
        return !isMaximalRect;
      });

      if (innerRects.length === 0) {
        continue;
      }

      let mergedRect = innerRects[0];
      for (let i = 0; i < innerRects.length; i++) {
        const current = innerRects[i];
        if (current.left <= mergedRect.right + 2) {
          mergedRect = new DOMRect(
            mergedRect.left,
            Math.min(mergedRect.top, current.top),
            Math.max(current.right - mergedRect.left, mergedRect.width),
            Math.max(
              current.bottom - Math.min(mergedRect.top, current.top),
              mergedRect.height
            )
          );
        } else {
          outRects.push(mergedRect);
          mergedRect = current;
        }
      }
      outRects.push(mergedRect);
    }
  }
  return outRects;
}

/**
 * Get the highlight rects for a selection.
 */
export function getSelectionRects(
  editor: LexicalEditor,
  selection: BaseSelection | null
): DOMRect[] {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return [];
  }
  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  const anchorOffset = selection.anchor.offset;
  const focusOffset = selection.focus.offset;
  return getRangeRects(
    editor,
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset
  );
}

/**
 * Gets highlight rects for non-collapsed range.
 */
function getRangeRects(
  editor: LexicalEditor,
  anchorNode: any,
  anchorOffset: number,
  focusNode: any,
  focusOffset: number
): DOMRect[] {
  const range = createDOMRange(
    editor,
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset
  );
  if (!range) return [];
  const rootWidth = editor.getRootElement()?.getBoundingClientRect().width;
  return createRectsFromDOMRange(range, 3, rootWidth);
}

/**
 * The layer that should be the portal mount point for all the highlights in the editor.
 */
export function HighlightLayer(props: {
  editor: LexicalEditor;
  ref: (el: HTMLElement) => void;
}) {
  const [editorRootParent, setEditorRootParent] = createSignal<HTMLElement>();
  lazyRegister(
    () => props.editor,
    (editor) => {
      return editor.registerRootListener((root) => {
        if (root !== null && root!.parentElement !== null) {
          setEditorRootParent(root.parentElement);
          return;
        }
        setEditorRootParent();
      });
    }
  );
  return (
    <Show when={editorRootParent()}>
      {(parent) => (
        <Portal mount={parent()}>
          <div
            class="__highlight-layer absolute top-0 left-0 opacity-35"
            ref={props.ref}
            style={{
              'z-index': MarkdownStackingContext.Highlights,
            }}
          />
        </Portal>
      )}
    </Show>
  );
}

function getLocationRects(
  editor: LexicalEditor,
  location: MarkdownLocation,
  mapping?: NodeIdMappings
): DOMRect[] {
  const [anchorNode, focusNode] = editor.getEditorState().read(() => {
    let anchorKey: NodeKey | undefined;
    let focusKey: NodeKey | undefined;
    if (location.type === 'persistent') {
      if (!mapping) {
        console.error('Mapping is required for persistent locations');
        return [];
      }
      anchorKey = mapping.idToNodeKeyMap.get(location.anchor.id);
      focusKey = mapping.idToNodeKeyMap.get(location.focus.id);
    } else {
      anchorKey = location.anchor.key;
      focusKey = location.focus.key;
    }

    if (!anchorKey || !focusKey) return [];

    const anchorNode = $getNodeByKey(anchorKey);
    const focusNode = $getNodeByKey(focusKey);
    if (!anchorNode || !focusNode) return [];
    return [anchorNode, focusNode];
  });

  if (!anchorNode || !focusNode) return [];
  return getRangeRects(
    editor,
    anchorNode,
    location.anchor.offset,
    focusNode,
    location.focus.offset
  );
}

export function LocationHighlight(props: {
  editor: LexicalEditor;
  location?: PersistentLocation;
  mapping: NodeIdMappings;
  mountRef: HTMLElement;
  class?: string;
  padding?: PaddingValue;
  captureBoundingDomRect?: (rect: DOMRect) => void;
}): JSX.Element;

export function LocationHighlight(props: {
  editor: LexicalEditor;
  location?: EphemeralLocation;
  mountRef: HTMLElement;
  class?: string;
  padding?: PaddingValue;
  captureBoundingDomRect?: (rect: DOMRect) => void;
}): JSX.Element;

export function LocationHighlight(props: {
  editor: LexicalEditor;
  location?: MarkdownLocation;
  mapping?: NodeIdMappings;
  mountRef: HTMLElement;
  class?: string;
  padding?: PaddingValue;
  captureBoundingDomRect?: (rect: DOMRect) => void;
}) {
  // Simple signal that counts up to re-trigger layout.
  const [layout, setLayout] = createSignal(0);
  const inc = () => setLayout(layout() + 1);

  autoRegister(
    registerEditorWidthObserver(props.editor, inc, '[data-block-content]'),
    registerInternalLayoutShiftListener(props.editor, inc),
    registerMutationListener(props.editor, inc)
  );

  const rects = createMemo(() => {
    layout();
    if (!props.location) return [];
    return getLocationRects(props.editor, props.location, props.mapping);
  });

  const styles = () => {
    return rects().map((r) => {
      return getHighlightStyle(r, props.mountRef, props.padding ?? 0);
    });
  };

  createEffect(() => {
    if (props.captureBoundingDomRect) {
      const bounds = boundingRect(rects());
      props.captureBoundingDomRect(bounds);
    }
  });

  return (
    <Portal mount={props.mountRef}>
      <For each={styles()}>
        {(style) => {
          return (
            <div
              class={`absolute top-0 left-0 m-0 select-none pointer-events-none ${props.class ?? ''}`}
              style={style}
            />
          );
        }}
      </For>
    </Portal>
  );
}
