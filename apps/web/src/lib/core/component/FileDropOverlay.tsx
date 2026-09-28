import type { ParentProps } from 'solid-js';

/**
 * A themed file drop overlay for use with the fileDrop directive.
 */
export const FileDropOverlay = (props: ParentProps<{ valid?: boolean }>) => {
  const valid = () => props.valid !== false;
  return (
    <div
      class="absolute size-full inset-0 rounded-xl z-modal flex items-center justify-center"
      classList={{
        'bg-modal-overlay': valid(),
        'bg-failure-bg/80': !valid(),
      }}
    >
      <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-full shadow-lg shadow-drop-shadow px-4 py-2 flex items-center gap-2 font-sans text-xs text-ink">
        {props.children}
      </div>
    </div>
  );
};
