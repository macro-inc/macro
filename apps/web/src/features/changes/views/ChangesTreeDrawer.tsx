import * as Dialog from '@kobalte/core/dialog';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { Show } from 'solid-js';

/** Keep an inert exit frame, not a retained dialog's document listeners. */
export function ChangesTreeDrawer(props: {
  open: boolean;
  width: number;
  onClose: () => void;
  dock: (element: HTMLDivElement) => void;
}) {
  // Own the live dialog and its exit dock outside the transition's closing owner.
  let frameElement!: HTMLDivElement;
  const frame = (
    <div
      data-changes-tree-drawer-frame
      ref={frameElement}
      class="relative z-10 flex h-full max-w-full flex-col overflow-hidden border-r border-edge-muted bg-panel"
      style={{
        width: `${props.width}px`,
        'pointer-events': props.open ? 'auto' : 'none',
      }}
      inert={!props.open}
      aria-hidden={!props.open}
    >
      <Show
        when={props.open}
        fallback={<div ref={props.dock} class="size-full" />}
      >
        <Dialog.Content
          aria-label="Changed files"
          class="size-full outline-none"
          onInteractOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-changes-tree-backdrop]')
            ) {
              // The backdrop closes explicitly; preserve default trigger restoration.
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => {
            // A queued close must not steal focus after an immediate reopen.
            if (props.open) event.preventDefault();
          }}
        >
          <div ref={props.dock} class="size-full" />
        </Dialog.Content>
      </Show>
    </div>
  );
  return (
    <div class="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <CollapseTransition
        open={props.open}
        axis="width"
        expandedSize={props.width}
        container={() => frameElement}
      >
        <div
          class="h-full"
          ref={(element) => {
            // A fresh wrapper lets an interrupted exit release only its old owner.
            if (frame instanceof Node) element.append(frame);
          }}
        />
      </CollapseTransition>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close file tree backdrop"
        data-changes-tree-backdrop
        data-testid="changes-tree-backdrop"
        class="pointer-events-auto absolute inset-0 bg-modal-overlay"
        classList={{ hidden: !props.open }}
        style={{ 'z-index': 0 }}
        onPointerDown={(event) => event.preventDefault()}
        onClick={props.onClose}
      />
    </div>
  );
}
