import type { ParentProps } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerControls(props: ParentProps) {
  const state = useMobileComposer();
  return (
    <div
      data-composer-controls
      class="flex shrink-0 items-center gap-1"
      classList={{ 'w-full h-9': !state.collapsed() }}
    >
      {props.children}
    </div>
  );
}
