import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { PillButton } from '@components/app/mobile/PillTabs';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { createSignal, type JSX, onCleanup } from 'solid-js';

/** Restores the picker focus before opening a row's next dialog or view. */
export function SavedViewPicker(props: {
  label: string;
  active: boolean;
  scopeKey: string | undefined;
  children: (onAction: (action: () => void) => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  let pendingAction:
    | { scopeKey: string | undefined; run: () => void }
    | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    pendingAction = undefined;
  });
  const afterClose = (present: boolean) => {
    if (present || open()) return;
    // Let Corvu finish its presence update before restoring focus and opening
    // another focus trap, matching other drawer-to-dialog handoffs.
    queueMicrotask(() => {
      if (disposed || open()) return;
      trigger()?.focus({ preventScroll: true });
      queueMicrotask(() => {
        if (disposed || open()) return;
        const action = pendingAction;
        pendingAction = undefined;
        if (action && action.scopeKey === props.scopeKey) action.run();
      });
    });
  };
  return (
    <MobileDrawer
      open={open()}
      onOpenChange={(next) => {
        if (next) pendingAction = undefined;
        setOpen(next);
      }}
      restoreFocus={false}
      onContentPresentChange={afterClose}
    >
      <MobileDrawer.Trigger
        ref={setTrigger}
        as={PillButton}
        active={props.active}
        class="flex max-w-64 items-center gap-1.5"
        aria-label={props.label}
      >
        <span class="truncate">{props.label}</span>
        <CaretDownIcon class="size-3.5 shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content>
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="px-6 pb-3 text-base font-medium">
            {t('viewMenus.savedViews')}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody class="px-3">
            {props.children((action) => {
              pendingAction = { scopeKey: props.scopeKey, run: action };
              setOpen(false);
            })}
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
