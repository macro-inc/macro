import type { ParentProps } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerEditor(props: ParentProps) {
  const state = useMobileComposer();
  return (
    <div class="min-w-0 flex-1" classList={{ 'w-full': !state.collapsed() }}>
      {props.children}
    </div>
  );
}
