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
            // Every floating dialog dims the page behind it with the accent
            // sheen; `visibleScrim` layers the heavier legacy coat on top for
            // destructive flows (its background-color wins over the scrim's).
            'fixed inset-0 z-modal scrim-glass',
            animateOnOpen() && 'dialog-overlay-open-animation',
            Boolean(props.visibleScrim) && 'bg-modal-overlay'
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
              'portal-scope isolate rounded-xl bg-dialog',
              // Floating dialogs (cmd+k, create, confirm) get the glass
              // treatment; fullscreen fills the viewport, so translucency and
              // a cast shadow would just bleed the page through the content.
              // --color-dialog goes translucent inside so nested bg-dialog
              // chrome (e.g. cmd+k's toolbar/footer) reads as the same pane.
              props.fullscreen
                ? 'size-full'
                : 'w-200 max-w-[calc(100vw-16px)] glass-lg bg-menu-glass [--color-dialog:var(--color-menu-glass)]',
              animateOnOpen() &&
                (props.fullscreen
                  ? 'dialog-fullscreen-open-animation'
                  : 'dialog-content-open-animation'),
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
