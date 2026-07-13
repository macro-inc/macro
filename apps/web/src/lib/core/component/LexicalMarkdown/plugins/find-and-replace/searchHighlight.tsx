import { FindAndReplaceStore } from '@block-md/signal/findAndReplaceStore';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { mergeRegister } from '@lexical/utils';
import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import { createEffect, For } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  autoRegister,
  lazyRegister,
  registerEditorWidthObserver,
  registerInternalLayoutShiftListener,
} from '../shared/utils';
import type { NodekeyOffset } from './findAndReplacePlugin';
import {
  type FloatingStyle,
  getFloatingSearchHighlightPosition,
} from './getFloatingSearchHighlightStyle';

function getFirstChild(htmlEl: ChildNode | null | undefined) {
  if (htmlEl?.firstChild) {
    return getFirstChild(htmlEl.firstChild);
  }
  return htmlEl;
}

function registerEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void
): () => void;
function registerEventListener(
  target: HTMLElement | null,
  type: string,
  listener: EventListener
) {
  if (!target) return () => {};
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

export function SearchHighlight({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}): null {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;
  let stateListOffsetRef: NodekeyOffset[] = [];
  let animationFrame: number | undefined;

  const updateTextFormatFloatingToolbar = createCallback(
    (listOffset: NodekeyOffset[]) => {
      const newStyles: { style: FloatingStyle; idx: number | undefined }[] = [];
      let matches = 0;
      listOffset.map((offset: NodekeyOffset) => {
        const editorInstance = editor();
        if (!editorInstance) return;
        const htmlEl = getFirstChild(
          editorInstance.getElementByKey(offset.key)?.firstChild
        );
        if (!htmlEl) return;
        const range = document.createRange();
        try {
          range.setStart(htmlEl, offset.offset.start);
          range.setEnd(htmlEl, offset.offset.end);
          const rects = range.getClientRects();
          [...rects].map((rect) => {
            const newStyle = getFloatingSearchHighlightPosition(
              rect,
              anchorElem
            );
            const styleWidth = newStyle.width;
            if (
              Number.parseInt(
                styleWidth.substring(0, styleWidth.length - 2)
              ) !== 4
            ) {
              newStyles.push({ style: newStyle, idx: offset.pairKey });
              matches = Math.max(matches, offset.pairKey ?? 0);
            }
          });
        } catch (error) {
          console.error(error);
        }
      });

      FindAndReplaceStore.set('styles', newStyles);
      FindAndReplaceStore.set('matches', matches);
    }
  );

  const update = createCallback(() => {
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
    }

    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined;
      const editorInstance = editor();
      if (!editorInstance) return;

      editorInstance.getEditorState().read(() => {
        updateTextFormatFloatingToolbar(stateListOffsetRef);
      });
    });
  });

  createEffect(() => {
    stateListOffsetRef = FindAndReplaceStore.get.listOffset;
    update();
  });

  lazyRegister(editor, (editorInstance) =>
    mergeRegister(
      registerInternalLayoutShiftListener(editorInstance, update),
      registerEditorWidthObserver(
        editorInstance,
        update,
        '[data-block-content]'
      ),
      editorInstance.registerUpdateListener(
        ({ dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
          update();
        }
      )
    )
  );

  autoRegister(
    registerEventListener(anchorElem.parentElement, 'scroll', update),
    () => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
    }
  );

  return null;
}

export function FloatingSearchHighlight({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}) {
  return (
    <Portal mount={anchorElem}>
      <For each={FindAndReplaceStore.get.styles}>
        {(item) => (
          <div
            style={item.style}
            class={cn(
              'z-150 m-0 text-transparent h-4.5 absolute top-0 left-0 opacity-50 pointer-events-none',
              item.idx === FindAndReplaceStore.get.currentMatch + 1
                ? 'bg-accent'
                : 'bg-accent/50'
            )}
          />
        )}
      </For>
    </Portal>
  );
}
