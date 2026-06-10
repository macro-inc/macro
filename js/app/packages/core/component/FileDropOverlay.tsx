import type { ParentProps } from 'solid-js';

/**
 * A themed file drop overlay for use with the fileDrop directive.
 */
export const FileDropOverlay = (props: ParentProps<{ valid?: boolean }>) => {
  const valid = () => props.valid !== false;
  return (
    <div
      class="absolute size-full inset-0 rounded-xl z-modal bg-modal-overlay pattern-diagonal-4 flex items-center justify-center"
      classList={{
        'pattern-edge-muted': valid(),
        'pattern-failure-bg': !valid(),
      }}
    >
      <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-lg shadow-lg shadow-drop-shadow px-4 py-3 flex items-center gap-2 text-sm text-ink">
        {props.children}
      </div>
    </div>
  );
};
