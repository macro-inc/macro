import { FindAndReplaceStore } from '@block-md/signal/findAndReplaceStore';
import { mdStore } from '@block-md/signal/markdownBlockData';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, For, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
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

export function SearchHighlight({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}): null {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;
  let stateListOffsetRef: NodekeyOffset[] = [];

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

  createEffect(() => {
    stateListOffsetRef = FindAndReplaceStore.get.listOffset;
    updateTextFormatFloatingToolbar(stateListOffsetRef);
  });

  onMount(() => {
    const scrollerElem = anchorElem.parentElement;

    const update = () => {
      if (stateListOffsetRef) {
        const editorInstance = editor();
        if (!editorInstance) return;

        editorInstance.getEditorState().read(() => {
          updateTextFormatFloatingToolbar(stateListOffsetRef);
        });
      }
    };

    window.addEventListener('resize', update);
    if (scrollerElem) {
      scrollerElem.addEventListener('scroll', update);
    }

    onCleanup(() => {
      window.removeEventListener('resize', update);
      if (scrollerElem) {
        scrollerElem.removeEventListener('scroll', update);
      }
    });
  });

  return null;
}

export function FloatingSearchHighlight({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}) {
  // SCUFFED THEME: how should we define the highlight color?
  return (
    <Portal mount={anchorElem}>
      <For each={FindAndReplaceStore.get.styles}>
        {(item) => (
          <div
            style={item.style}
            class={`z-[150] m-0 text-transparent h-[18px] absolute top-0 left-0 opacity-50 pointer-events-none ${
              item.idx === FindAndReplaceStore.get.currentMatch + 1
                ? 'bg-purple-300'
                : 'bg-purple-300/50'
            }`}
          />
        )}
      </For>
    </Portal>
  );
}
