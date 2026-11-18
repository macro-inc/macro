import { type ParentProps, Show } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerAttachments(props: ParentProps) {
  const state = useMobileComposer();
  return (
    <Show when={!state.collapsed()}>
      <div class="w-full min-w-0">{props.children}</div>
    </Show>
  );
}
