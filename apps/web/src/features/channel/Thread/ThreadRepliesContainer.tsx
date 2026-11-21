import type { ParentProps } from 'solid-js';
import { threadOffsetX } from './utils/thread-rail-geometry';

export function ThreadRepliesContainer(
  props: ParentProps<{
    /** Keep replies in the root's avatar column instead of indenting them. */
    flat?: boolean;
  }>
) {
  return (
    <div
      class="flex flex-col w-full py-(--thread-padding-y)"
      style={{
        'padding-left': props.flat ? undefined : threadOffsetX,
        // Gutter controls beside a reply stay in the root's lane.
        '--thread-gutter-inset': props.flat ? undefined : threadOffsetX,
      }}
    >
      {props.children}
    </div>
  );
}
