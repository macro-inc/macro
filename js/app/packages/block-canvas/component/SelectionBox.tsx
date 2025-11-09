import { createMemo, Show } from 'solid-js';
import type { Rectangle } from '../util/rectangle';

export function SelectionBox(props: { rect?: Rectangle }) {
  // const currentScale = useRenderState().currentScale;

  const show = createMemo(() => {
    if (!props.rect) return false;
    return props.rect.width > 0 && props.rect.height > 0;
  });

  return (
    <Show when={show()}>
      <div class="absolute bg-edge/30" style={props.rect!.toCssRect()}></div>
    </Show>
  );
}
