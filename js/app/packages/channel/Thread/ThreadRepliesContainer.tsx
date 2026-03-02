import type { ParentProps } from 'solid-js';
import { threadOffsetX } from './thread-rail-geometry';

export function ThreadRepliesContainer(props: ParentProps) {
  return (
    <div
      class="flex flex-col w-full pb-3"
      style={{
        'padding-left': threadOffsetX,
      }}
    >
      {props.children}
    </div>
  );
}
