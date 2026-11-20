import type { ParentProps } from 'solid-js';
import { useMobileComposer } from './context';
export function MobileComposerControls(props: ParentProps) {
  const state = useMobileComposer();
  return (
    <div
      data-composer-controls
      class="phone-composer-controls flex h-9 w-full shrink-0 items-center gap-1"
      inert={state.collapsed()}
      aria-hidden={state.collapsed()}
    >
      {props.children}
    </div>
  );
}
