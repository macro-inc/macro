import type { ParentProps } from 'solid-js';
import { type FileListSize, TEXT_SIZE_CLASSES } from './constants';

export function TruncatedText(
  props: ParentProps<{
    size?: FileListSize;
  }>
) {
  return (
    <div
      class={`w-full text-ink ${TEXT_SIZE_CLASSES[props.size ?? 'sm']} font-medium justify-between font-sans overflow-hidden text-clip whitespace-nowrap flex items-center align-middle gap-2 min-w-0`}
    >
      <span class="truncate min-w-0 w-full">{props.children}</span>
    </div>
  );
}
