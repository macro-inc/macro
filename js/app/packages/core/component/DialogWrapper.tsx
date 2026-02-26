import { Dialog } from '@kobalte/core';
import { cn } from '@ui/utils/classname';
import type { JSXElement, Ref } from 'solid-js';
import { ClippedPanel } from './ClippedPanel';

export interface DialogWrapperProps {
  children: JSXElement;
  class?: string;
  width?: string;
  overlayRef?: Ref<HTMLDivElement>;
  contentRef?: Ref<HTMLDivElement>;
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
        <div
          class={cn(
            'max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-hidden'
          )}
          style={{ width: width }}
        >
          <ClippedPanel tl active>
            <Dialog.Content
              class={cn('[&>*]:max-h-[75vh]', props.class)}
              ref={props.contentRef}
            >
              {props.children}
            </Dialog.Content>
          </ClippedPanel>
        </div>
      </div>
    </>
    // Overlay with Diagonal pattern
  );
}
