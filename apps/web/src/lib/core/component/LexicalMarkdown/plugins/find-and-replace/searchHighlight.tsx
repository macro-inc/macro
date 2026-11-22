import { mergeRegister } from '@lexical/utils';
import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import { createEffect, For, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
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
import { getSearchHighlightClientRects } from './searchHighlightTarget';

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

export type SearchHighlightItem = {
  style: FloatingStyle;
  idx: number | undefined;
};

/** Match count and one floating rect per rendered piece; 4px-wide rects are skipped. */
export function measureSearchHighlights(
  listOffset: NodekeyOffset[],
  getElementByKey: (key: string) => HTMLElement | null,
  anchorElem: HTMLElement
): { styles: SearchHighlightItem[]; matches: number } {
  const styles: SearchHighlightItem[] = [];
  const matches = listOffset.reduce(
    (max, offset) => Math.max(max, offset.pairKey ?? 0),
    0
  );
  for (const offset of listOffset) {
    const element = getElementByKey(offset.key);
    if (!element) continue;
    try {
      const rects = getSearchHighlightClientRects(element, offset.offset);
      for (const rect of rects) {
        const style = getFloatingSearchHighlightPosition(rect, anchorElem);
        const styleWidth = style.width;
        if (
          Number.parseInt(styleWidth.substring(0, styleWidth.length - 2)) !== 4
        ) {
          styles.push({ style, idx: offset.pairKey });
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
  return { styles, matches };
}

export function SearchHighlight(props: {
  anchorElem?: HTMLElement;
  listOffset: NodekeyOffset[];
  onStylesChange: (styles: SearchHighlightItem[]) => void;
  onMatchesChange: (matches: number) => void;
}): null {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;
  const anchorElem = () => props.anchorElem ?? document.body;
  let stateListOffsetRef: NodekeyOffset[] = [];
  let animationFrame: number | undefined;

  const updateTextFormatFloatingToolbar = createCallback(
    (listOffset: NodekeyOffset[]) => {
      const editorInstance = editor();
      const measured = measureSearchHighlights(
        listOffset,
        (key) => editorInstance?.getElementByKey(key) ?? null,
        anchorElem()
      );
      props.onStylesChange(measured.styles);
      props.onMatchesChange(measured.matches);
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
    stateListOffsetRef = props.listOffset;
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
    registerEventListener(anchorElem().parentElement, 'scroll', update),
    () => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
    }
  );

  return null;
}

export function FloatingSearchHighlight(props: {
  anchorElem?: HTMLElement;
  styles: SearchHighlightItem[];
  currentMatch: number;
}) {
  return (
    <Portal mount={props.anchorElem}>
      <For each={props.styles}>
        {(item) => (
          <div
            style={item.style}
            class={cn(
              'z-10 m-0 text-transparent h-4.5 absolute top-0 left-0 opacity-50 pointer-events-none',
              item.idx === props.currentMatch + 1 ? 'bg-accent' : 'bg-accent/50'
            )}
          />
        )}
      </For>
    </Portal>
  );
}
