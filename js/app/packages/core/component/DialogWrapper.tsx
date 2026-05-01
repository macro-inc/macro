import { Dialog } from '@kobalte/core';
import { cn } from '@ui/utils/classname';
import type { JSXElement, Ref } from 'solid-js';
import { Panel } from '@ui';

export interface DialogWrapperProps {
  children: JSXElement;
  class?: string;
  width?: string;
  overlayRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Your one-stop-shop for creating Macro-themed Dialogs. Handles both the Overlay and the frame around the Dialog Content.
 *
 * Correct usage is to put this immediately below the <Dialog.Portal>. No other Dialog machinery necesary. Just this and then the content.
 *
 * Note: DialogWrapper constrains its height by applying a max-height to its immediate children. This allows the child content to be properly constrained (e.g. for flex-box layouts) without the children needing to know that they are inside a dialog. For this to work as expected, child content should start with a single container element.
 */
export function DialogWrapper(props: DialogWrapperProps) {
  const width = props.width ?? '800px';

  return (
    <>
      <Dialog.Overlay
        class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4"
        ref={props.overlayRef}
      />
      <div class="z-modal fixed inset-0">
        <Dialog.Content
          class={cn(
            'max-w-[calc(100vw-16px)] mt-40 mx-auto overflow-hidden portal-scope'
          )}
          style={{ width: width }}
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <Panel depth={3} active>
            <div
              class={cn('*:max-h-[75vh]', props.class)}
              ref={props.contentRef}
            >
              {props.children}
            </div>
          </Panel>
        </Dialog.Content>
      </div>
    </>
    // Overlay with Diagonal pattern
  );
}
