import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MarkdownStackingContext } from '../../constants';
import type { PersistentLocation } from '../../plugins/location/locationPlugin';
import { nativeLocationRange } from '../../plugins/location/native';
import {
  createRectsFromDOMRange,
  HighlightRects,
  type PaddingValue,
} from './Highlights';

/** Source HighlightLayer plus LocationHighlight over a native view. */
export function NativeLocationHighlight(props: {
  view: EditorView;
  location?: PersistentLocation;
  class?: string;
  padding?: PaddingValue;
}) {
  const [layer, setLayer] = createSignal<HTMLDivElement>();
  const [layout, setLayout] = createSignal(undefined, { equals: false });
  const relayout = () => setLayout();
  onCleanup(props.view.onCommit(relayout));
  const resize = new ResizeObserver(relayout);
  resize.observe(props.view.root);
  onCleanup(() => resize.disconnect());

  const rects = () => {
    layout();
    const location = props.location;
    if (!location) return [];
    const range = nativeLocationRange(props.view, location);
    if (!range) return [];
    return createRectsFromDOMRange(
      range,
      3,
      props.view.root.getBoundingClientRect().width
    );
  };

  return (
    <Show when={props.view.root.parentElement}>
      {(parent) => (
        <Portal mount={parent()}>
          <div
            class="__highlight-layer absolute top-0 left-0 opacity-35"
            ref={setLayer}
            style={{ 'z-index': MarkdownStackingContext.Highlights }}
          />
          <Show when={layer()}>
            {(mount) => (
              <HighlightRects
                rects={rects()}
                mountRef={mount()}
                class={props.class}
                padding={props.padding}
              />
            )}
          </Show>
        </Portal>
      )}
    </Show>
  );
}
