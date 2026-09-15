import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import type { Accessor, JSX, Ref, Setter, ValidComponent } from 'solid-js';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';

const DIALOG_HANDOFF_WINDOW_MS = 180;

let openDialogCount = 0;
let lastAllDialogsClosedAt = Number.NEGATIVE_INFINITY;

const DialogDrawerContext = createContext<{
  setTitleId: Setter<Accessor<string | undefined> | undefined>;
  setDescriptionId: Setter<Accessor<string | undefined> | undefined>;
}>();

export type DialogProps = {
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onOpenChange?: (open: boolean) => void;
  contentRef?: Ref<HTMLDivElement> /* content element ref  */;
  position?: 'top' | 'center' /* Vertical position    */;
  /** Edge-to-edge takeover: fills the viewport with no gutter or centering. */
  fullscreen?: boolean /* Fill the viewport */;
  children: JSX.Element /* Content children */;
  class?: string /* classes for content */;
  open: boolean /* if dialog is open */;
  visibleScrim?: boolean /* if the scrim is visible */;
  /** Desktop opening animation; mobile drawers own their transitions. */
  animate?: boolean;
};

export function Dialog(props: DialogProps) {
  return (
    <Show
      when={isMobile() && !props.fullscreen}
      fallback={
        <DialogDrawerContext.Provider value={undefined}>
          <DesktopDialog {...props} />
        </DialogDrawerContext.Provider>
      }
    >
      <DialogDrawer {...props} />
    </Show>
  );
}

function DialogDrawer(props: DialogProps) {
  const [titleId, setTitleId] = createSignal<Accessor<string | undefined>>();
  const [descriptionId, setDescriptionId] =
    createSignal<Accessor<string | undefined>>();
  return (
    <DialogDrawerContext.Provider value={{ setTitleId, setDescriptionId }}>
      <MobileDrawer
        labelId={titleId()?.()}
        descriptionId={descriptionId()?.()}
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
        onEscapeKeyDown={props.onEscapeKeyDown}
        onInitialFocus={props.onOpenAutoFocus}
        onFinalFocus={props.onCloseAutoFocus}
        restoreFocus
        noOutsidePointerEvents
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay
            class={cn(props.visibleScrim && 'bg-modal-overlay')}
          />
          <MobileDrawer.Content
            ref={props.contentRef}
            maxHeight={100}
            class={cn('mx-auto max-w-[calc(100vw-16px)]', props.class)}
          >
            <MobileDrawer.Handle aria-hidden="true" />
            <MobileDrawer.ScrollBody>
              {/* Give desktop surfaces their natural height so their size-full
                  and overflow-clip styles cannot clip the drawer's scroll body. */}
              <div class="shrink-0 [&>[data-layer]>[data-surface]]:border-0! [&>[data-layer]>[data-surface]]:rounded-none [&>[data-layer]>[data-surface]]:bg-transparent">
                {props.children}
              </div>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </DialogDrawerContext.Provider>
  );
}

function DesktopDialog(props: DialogProps) {
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
                : 'w-200 max-w-[calc(100vw-16px)] glass bg-menu-glass [--color-dialog:var(--color-menu-glass)] [&>[data-layer]>[data-surface]]:border-0!',
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

const DialogCloseButton: typeof KobalteDialog.CloseButton = (props) => {
  if (useContext(DialogDrawerContext)) return null;
  return <KobalteDialog.CloseButton {...props} />;
};

const DialogDescription: typeof KobalteDialog.Description = (props) => {
  const drawer = useContext(DialogDrawerContext);
  if (!drawer) return <KobalteDialog.Description {...props} />;
  const [, rest] = splitProps(props, ['id']);
  // Corvu registers IDs on its root, while Kobalte accepts them on each slot.
  drawer.setDescriptionId(() => () => props.id);
  onCleanup(() => drawer.setDescriptionId(undefined));
  return <MobileDrawer.Description<ValidComponent> {...rest} />;
};

const DialogTitle: typeof KobalteDialog.Title = (props) => {
  const drawer = useContext(DialogDrawerContext);
  if (!drawer) return <KobalteDialog.Title {...props} />;
  const [, rest] = splitProps(props, ['id']);
  drawer.setTitleId(() => () => props.id);
  onCleanup(() => drawer.setTitleId(undefined));
  return <MobileDrawer.Title<ValidComponent> {...rest} />;
};

Dialog.CloseButton = DialogCloseButton;
Dialog.Description = DialogDescription;
Dialog.Title = DialogTitle;
