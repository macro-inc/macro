import type { ParentProps } from 'solid-js';
export function MobileComposerDrawer(props: ParentProps<{ open: boolean }>) {
  return (
    <div
      class="mb-2 min-w-0"
      hidden={!props.open}
      inert={!props.open}
      aria-hidden={!props.open}
    >
      {props.children}
    </div>
  );
}
