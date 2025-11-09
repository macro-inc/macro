import type { ParentProps } from 'solid-js';

export function Center(
  props: ParentProps<{
    ref?: (el: HTMLDivElement) => void;
  }>
) {
  return (
    <div
      ref={props.ref}
      class="flex justify-self-center py-1 flex-row w-full h-9 justify-center items-center gap-"
    >
      {props.children}
    </div>
  );
}
