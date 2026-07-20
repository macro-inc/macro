import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import type { JSX, Ref } from 'solid-js';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { cn } from '../utils/classname';

const DIALOG_HANDOFF_WINDOW_MS = 180;

let openDialogCount = 0;
let lastAllDialogsClosedAt = Number.NEGATIVE_INFINITY;

export type DialogProps = {
  onEscapeKeyDown?: (event: KeyboardEvent) => void /* Forwarded to Kobalte */;
  onCloseAutoFocus?: (event: Event) => void /* Forwarded to Kobalte */;
  onOpenAutoFocus?: (event: Event) => void /* Forwarded to Kobalte */;
  onOpenChange?: (open: boolean) => void /* Forwarded to Kobalte */;
  contentRef?: Ref<HTMLDivElement> /* content element ref  */;
  position?: 'top' | 'center' /* Vertical position    */;
  /** Edge-to-edge takeover: fills the viewport with no gutter or centering. */
  fullscreen?: boolean /* Fill the viewport */;
  children: JSX.Element /* Content children */;
  class?: string /* classes for content */;
  open: boolean /* if dialog is open */;
  visibleScrim?: boolean /* if the scrim is visible */;
  animate?: boolean /* is the menu/dialog animated on open */;
};

export function Dialog(props: DialogProps) {
  const [animateOnOpen, setAnimateOnOpen] = createSignal(false);
  let countedOpen = false;

  createEffect(() => {
    if (props.open) {
      if (!countedOpen) {
        const isDialogHandoff =
          openDialogCount > 0 ||
          performance.now() - lastAllDialogsClosedAt < DIALOG_HANDOFF_WINDOW_MS;

        setAnimateOnOpen(!isDialogHandoff && Boolean(props.animate));
        openDialogCount += 1;
        countedOpen = true;
      }
      return;
    }

    if (countedOpen) {
      openDialogCount = Math.max(0, openDialogCount - 1);
      countedOpen = false;
      setAnimateOnOpen(false);

      if (openDialogCount === 0) {
        lastAllDialogsClosedAt = performance.now();
      }
    }
  });

  onCleanup(() => {
    if (!countedOpen) return;

    openDialogCount = Math.max(0, openDialogCount - 1);

    if (openDialogCount === 0) {
      lastAllDialogsClosedAt = performance.now();
    }
  });

  return (
    <KobalteDialog onOpenChange={props.onOpenChange} open={props.open} modal>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay
          class={cn(
            'invisible fixed inset-0 z-modal bg-modal-overlay',
            animateOnOpen() && 'dialog-overlay-open-animation',
            Boolean(props.visibleScrim) && 'visible'
          )}
        />
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
              'portal-scope isolate rounded-xl',
              props.fullscreen ? 'size-full' : 'w-200 max-w-[calc(100vw-16px)]',
              animateOnOpen() &&
                (props.fullscreen
                  ? 'dialog-fullscreen-open-animation'
                  : 'dialog-content-open-animation'),
              props.class
            )}
            onCloseAutoFocus={props.onCloseAutoFocus}
            onEscapeKeyDown={props.onEscapeKeyDown}
            onOpenAutoFocus={props.onOpenAutoFocus}
            style={{
              'box-shadow':
                '0 5px 40px rgba(0, 0, 0, 0.1), 0 5px 50px rgba(0,0,0,0.03)',
            }}
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
