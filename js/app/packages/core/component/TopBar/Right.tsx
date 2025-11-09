import type { ParentProps } from 'solid-js';

export function Right(props: ParentProps) {
  return (
    <div class={` flex flex-row w-fit h-8 justify-end items-center gap-2`}>
      {props.children}
    </div>
  );
}
