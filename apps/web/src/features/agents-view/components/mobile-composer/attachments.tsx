import type { ParentProps } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerAttachments(props: ParentProps) {
  const state = useMobileComposer();
  return (
    <div class="w-full min-w-0" hidden={state.collapsed()}>
      {props.children}
    </div>
  );
}
