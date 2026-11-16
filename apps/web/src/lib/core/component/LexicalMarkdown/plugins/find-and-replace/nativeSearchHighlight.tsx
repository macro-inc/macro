import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createEffect, on, onCleanup } from 'solid-js';
import type { NodekeyOffset } from './findAndReplacePlugin';
import {
  measureSearchHighlights,
  type SearchHighlightItem,
} from './searchHighlight';

/**
 * Native SearchHighlight: measures on match changes, published content
 * changes, editor resizes and scroller scrolls, one animation frame later.
 */
export function NativeSearchHighlight(props: {
  view: EditorView;
  anchorElem: HTMLElement;
  listOffset: NodekeyOffset[];
  contentRevision: number;
  onStylesChange: (styles: SearchHighlightItem[]) => void;
  onMatchesChange: (matches: number) => void;
}): null {
  let animationFrame: number | undefined;
  const update = () => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined;
      if (!props.view.isMounted) return;
      const measured = measureSearchHighlights(
        props.listOffset,
        (key) => props.view.getElementByKey(Number(key)),
        props.anchorElem
      );
      props.onStylesChange(measured.styles);
      props.onMatchesChange(measured.matches);
    });
  };

  createEffect(
    on(
      () => [props.listOffset, props.contentRevision, props.anchorElem],
      update
    )
  );

  createEffect(() => {
    const root = props.view.root;
    const resize = new ResizeObserver(update);
    resize.observe(root.closest('[data-block-content]') ?? root);
    const scroller = props.anchorElem.parentElement;
    scroller?.addEventListener('scroll', update);
    onCleanup(() => {
      resize.disconnect();
      scroller?.removeEventListener('scroll', update);
    });
  });

  onCleanup(() => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  });

  return null;
}
