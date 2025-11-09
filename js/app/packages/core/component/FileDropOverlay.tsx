import type { ParentProps } from 'solid-js';

/**
 * A themed file drop overlay for use with the fileDrop directive.
 */
export const FileDropOverlay = (props: ParentProps<{ valid?: boolean }>) => {
  const valid = () => props.valid !== false;
  return (
    <div
      class="absolute size-full inset-0 z-modal bg-modal-overlay pattern-diagonal-8 flex items-center justify-center"
      classList={{
        'pattern-edge-muted': valid(),
        'pattern-failure-bg': !valid(),
      }}
    >
      <div class="bg-menu border-1 border-edge px-8 py-4 text-xs text-ink-muted shadow-md">
        {props.children}
      </div>
    </div>
  );
};
