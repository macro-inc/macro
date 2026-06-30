import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import type { JSX, Ref } from 'solid-js';
import { cn } from '../utils/classname';

export type DialogProps = {
  onEscapeKeyDown?: (event: KeyboardEvent) => void /* Forwarded to Kobalte */;
  onCloseAutoFocus?: (event: Event) => void /* Forwarded to Kobalte */;
  onOpenAutoFocus?: (event: Event) => void /* Forwarded to Kobalte */;
  onOpenChange?: (open: boolean) => void /* Forwarded to Kobalte */;
  contentRef?: Ref<HTMLDivElement> /* content element ref  */;
  position?: 'top' | 'center' /* Vertical position    */;
  /** Edge-to-edge takeover: fills the viewport with no gutter or centering. */
  fullscreen?: boolean /* Fill the viewport    */;
  children: JSX.Element /* Content children     */;
  class?: string /* classes for content  */;
  open: boolean /* if dialog is open    */;
};

export function Dialog(props: DialogProps) {
  return (
    <KobalteDialog onOpenChange={props.onOpenChange} open={props.open} modal>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
        <div
          class={cn(
            'fixed top-0 bottom-(--virtual-keyboard-height,0) inset-x-0 z-modal flex',
            props.fullscreen
              ? 'inset-0'
              : cn(
                  'justify-center px-2',
                  props.position === 'center'
                    ? 'items-center'
                    : 'items-start pt-[10vh]'
                )
          )}
        >
          <KobalteDialog.Content
            ref={props.contentRef}
            class={cn(
              'overflow-hidden portal-scope isolate',
              props.fullscreen ? 'size-full' : 'w-200 max-w-[calc(100vw-16px)]',
              props.class
            )}
            onCloseAutoFocus={props.onCloseAutoFocus}
            onEscapeKeyDown={props.onEscapeKeyDown}
            onOpenAutoFocus={props.onOpenAutoFocus}
          >
            {props.children}
          </KobalteDialog.Content>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}

Dialog.CloseButton = KobalteDialog.CloseButton; /* Forwarded to Kobalte */
Dialog.Description = KobalteDialog.Description; /* Forwarded to Kobalte */
Dialog.Title = KobalteDialog.Title; /* Forwarded to Kobalte */
