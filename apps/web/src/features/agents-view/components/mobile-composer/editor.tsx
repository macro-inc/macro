import type { ParentProps } from 'solid-js';
export function MobileComposerEditor(props: ParentProps) {
  return (
    <div class="phone-composer-editor min-w-0 w-full">{props.children}</div>
  );
}
