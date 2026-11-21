import type { SplitState } from '@components/app/split-layout/layoutManager';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** The pane's real mount, without the panel's header and app-wide providers. */
export function SplitPanel(props: { split: SplitState }) {
  return (
    <Show when={props.split.mount.kind === 'block'} fallback={<p>List view</p>}>
      <Dynamic component={props.split.mount.element} />
    </Show>
  );
}
