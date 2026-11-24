import type { JSX, ParentProps } from 'solid-js';

/** A header drag surface; interactive children keep their own pointer behavior. */
export function ComposerHeader(
  props: ParentProps<{
    f3?: boolean;
    onPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  }>
) {
  return (
    <div
      data-composer-header=""
      class={
        props.f3
          ? 'flex h-11 shrink-0 items-center gap-1.5 pt-2 px-2'
          : 'flex h-11 shrink-0 items-center gap-1.5 pt-2 pr-2.5 pb-2 pl-4'
      }
      classList={{
        'touch-none select-none cursor-grab active:cursor-grabbing': Boolean(
          props.onPointerDown
        ),
      }}
      onPointerDown={props.onPointerDown}
    >
      {props.children}
    </div>
  );
}
