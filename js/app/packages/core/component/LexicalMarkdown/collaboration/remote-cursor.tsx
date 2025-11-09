import {
  type Awareness,
  isAwarenessWithSelection,
  type PeerAwareness,
} from '@core/collab/awareness';
import type { LoroManager } from '@core/collab/manager';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { idToEmail } from '@core/user';
import { createDOMRange, createRectsFromDOMRange } from '@lexical/selection';
import type { NodeIdMappings } from '@lexical-core';
import { $getNodeByKey, $isTextNode, type LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSXElement,
  on,
  type Setter,
  Show,
} from 'solid-js';
import { For, Portal } from 'solid-js/web';
import type { FloatingStyle } from '../plugins/find-and-replace';
import { $cursorToLexicalPoint } from './cursor';
import type { LexicalSelectionAwareness } from './LexicalAwareness';

const warn = (...args: any[]) => {
  if (DEV_MODE_ENV) {
    console.warn('Remote cursors:', ...args);
  }
};

const SMALLEST_RECT_WIDTH = 1.5;
const SMALLEST_SELECTION_WIDTH = 5;

export type RemoteCursorWithStyle = {
  user: string | undefined;
  style: FloatingStyle[];
};

/** Processes the remote cursor updates and returns a list of RemoteCursorWithStyle */
export function $processRemoteCursorUpdates(
  editor: LexicalEditor,
  loroManager: LoroManager,
  mapping: NodeIdMappings,
  awarenessState: PeerAwareness<LexicalSelectionAwareness | undefined>[]
): RemoteCursorWithStyle[] {
  const rootEditorRect = editor.getRootElement()?.getBoundingClientRect();
  return awarenessState
    .map((awareness) => {
      const user = awareness.user.userId ?? 'Anonymous';
      if (isAwarenessWithSelection(awareness)) {
        const cursorStyle = awareness.selection
          ? $getRemoteCursorStyle(
              loroManager,
              editor,
              mapping,
              awareness,
              rootEditorRect
            )
          : undefined;
        return {
          user,
          style: cursorStyle,
        };
      }

      return undefined;
    })
    .filter(
      (cursor) => cursor?.style && cursor?.style?.length > 0
    ) as RemoteCursorWithStyle[];
}

/** Converts a given awareness state into a RemoteCursorWithStyle
 *
 * @param loroDoc - The LoroDoc instance
 * @param mapping - The LoroNodeMapping instance
 * @param peerAwareness - The awareness state of the peer(user)
 * @returns The RemoteCursorWithStyle
 */
function $getRemoteCursorStyle(
  loroManager: LoroManager,
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  peerAwareness: PeerAwareness<LexicalSelectionAwareness>,
  rootEditorRect: DOMRect | undefined
): FloatingStyle[] | undefined {
  const focus = peerAwareness.selection?.focus;
  const anchor = peerAwareness.selection?.anchor;

  if (!focus || !anchor) {
    warn('no focus or anchor');
    return undefined;
  }

  const anchorPoint = $cursorToLexicalPoint(
    anchor,
    loroManager,
    editor,
    mapping
  );

  const focusPoint = $cursorToLexicalPoint(focus, loroManager, editor, mapping);

  if (!anchorPoint || !focusPoint) {
    warn('no anchor or focus point', anchorPoint, focusPoint);
    return undefined;
  }

  const anchorNode = $getNodeByKey(anchorPoint.key);
  const focusNode = $getNodeByKey(focusPoint.key);

  if (!anchorNode || !focusNode) {
    warn('no anchor or focus node');
    return undefined;
  }

  let selectionRects;

  if (!$isTextNode(anchorNode) || !$isTextNode(focusNode)) {
    const spansOneNode = anchorNode === focusNode;
    const anchorElement = editor.getElementByKey(anchorNode.__key);
    const focusElement = editor.getElementByKey(focusNode.__key);

    if (!anchorElement || !focusElement || !rootEditorRect) {
      warn('could not find element for anchor or focus node');
      return undefined;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const focusRect = focusElement.getBoundingClientRect();

    const top = Math.min(anchorRect.top, focusRect.top);
    const left = Math.min(anchorRect.left, focusRect.left);
    const bottom = Math.max(anchorRect.bottom, focusRect.bottom);

    // If the node spans multiple nodes, we move the selection to the gutter
    let offset = spansOneNode ? 0 : 10;

    selectionRects = [
      {
        height: bottom - top,
        width: SMALLEST_RECT_WIDTH,
        top: top,
        left: left - offset,
      },
    ];
  } else {
    const range = createDOMRange(
      editor,
      anchorNode,
      anchorPoint.offset,
      focusNode,
      focusPoint.offset
    );

    if (!range) {
      warn('failed to get range from anchor and focus');
      return undefined;
    }
    selectionRects = createRectsFromDOMRange(editor, range);
  }

  if (!rootEditorRect) {
    warn('failed to find the root editor rect');
    return undefined;
  }

  return selectionRects.map((rect) => {
    const top = rect.top - rootEditorRect.top;
    const left = rect.left - rootEditorRect.left;

    const height = rect.height;
    const width =
      rect.width >= SMALLEST_RECT_WIDTH ? rect.width : SMALLEST_RECT_WIDTH;

    return {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${left}px, ${top}px)`,
      color: peerAwareness.user.color,
    };
  });
}

export type UseRemoteCursorsProps = {
  loroManager: LoroManager;
  mapping: NodeIdMappings;
  editor: LexicalEditor;
  awareness: Awareness<LexicalSelectionAwareness>;
};

export type UseRemoteCursors = {
  remoteCursors: Accessor<RemoteCursorWithStyle[]>;
  setRemoteCursors: Setter<RemoteCursorWithStyle[]>;
  refreshRemoteCursors: () => void;
  RemoteCursorsOverlay: (innerProps: {
    anchorElem?: HTMLElement | undefined;
    highlightLayer?: HTMLElement | undefined;
  }) => JSXElement;
};

export function useRemoteCursors(
  props: UseRemoteCursorsProps
): UseRemoteCursors {
  const [remoteCursors, setRemoteCursors] = createSignal<
    RemoteCursorWithStyle[]
  >([]);

  const refreshRemoteCursors = () => {
    const remoteCursorState = props.awareness.remote();
    if (!remoteCursorState) {
      warn("couldn't get remote cursor state");
      return;
    }
    let cursors: RemoteCursorWithStyle[] = [];
    props.editor.read(() => {
      cursors = $processRemoteCursorUpdates(
        props.editor,
        props.loroManager,
        props.mapping,
        remoteCursorState
      );
    });
    setRemoteCursors(cursors);
  };

  return {
    remoteCursors,
    setRemoteCursors,
    refreshRemoteCursors,
    RemoteCursorsOverlay: (innerProps: {
      anchorElem?: HTMLElement;
      highlightLayer?: HTMLElement;
    }) => {
      return (
        <RemoteCursorsOverlay
          anchorElem={innerProps.anchorElem}
          highlightLayer={innerProps.highlightLayer}
          editor={props.editor}
          mapping={props.mapping}
          loroManager={props.loroManager}
          awareness={props.awareness}
          remoteCursors={remoteCursors}
          setRemoteCursors={setRemoteCursors}
          refreshRemoteCursors={refreshRemoteCursors}
        />
      );
    },
  };
}

type RemoteCursorsOverlayProps = {
  anchorElem?: HTMLElement;
  highlightLayer?: HTMLElement;
  editor: LexicalEditor;
  mapping: NodeIdMappings;
  loroManager: LoroManager;
  awareness: Awareness<LexicalSelectionAwareness>;
  remoteCursors: Accessor<RemoteCursorWithStyle[]>;
  setRemoteCursors: Setter<RemoteCursorWithStyle[]>;
  refreshRemoteCursors: () => void;
};

function RemoteCursorsOverlay(props: RemoteCursorsOverlayProps) {
  createEffect(
    on(
      () => props.awareness.remote(),
      () => props.refreshRemoteCursors()
    )
  );

  return (
    <Portal mount={props.anchorElem}>
      <For each={props.remoteCursors()}>
        {(cursor) => {
          const userName = cursor.user
            ? idToEmail(cursor.user).split('@')[0]
            : 'Anonymous';

          const startStyle = cursor.style[0];

          const overlayColor = `var(--color-${startStyle.color})`;
          const tagName = `var(--color-${startStyle.color})`;
          const textColor = `var(--color-panel)`;

          const userTagHeight = 20;

          const [shouldShow, setShouldShow] = createSignal<boolean>(true);
          setTimeout(() => {
            setShouldShow(false);
          }, 1500);

          return (
            <>
              <Portal mount={props.highlightLayer}>
                <For each={cursor.style}>
                  {(style) => {
                    const { color: _, ...rest } = style;
                    const width = parseInt(rest.width.replace('px', ''));
                    const isSelection = width > SMALLEST_SELECTION_WIDTH;

                    return (
                      <div
                        class={`m-0 text-transparent absolute top-0 -left-[.5px] pointer-events-none`}
                        id={`remote-cursor`}
                        style={{
                          ...rest,
                          opacity: isSelection ? 1 : 1,
                          'background-color': overlayColor,
                        }}
                      />
                    );
                  }}
                </For>
              </Portal>
              <Show when={shouldShow()}>
                <div
                  class={`m-0 text-transparent absolute pointer-events-none w-auto! p-2 flex items-center`}
                  style={{
                    ...startStyle,
                    top: `-${userTagHeight + 2}px`,
                    left: startStyle.width,
                    height: `${userTagHeight}px`,
                    'background-color': tagName,
                    color: textColor,
                  }}
                >
                  <p class="text-xs font-mono">{userName}</p>
                </div>
              </Show>
            </>
          );
        }}
      </For>
    </Portal>
  );
}
