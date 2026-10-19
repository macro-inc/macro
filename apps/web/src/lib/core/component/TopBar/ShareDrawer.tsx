import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { blockNextClick } from '@core/util/blockNextClick';
import { Button } from '@ui';
import type { JSX } from 'solid-js';

export function getShareDrawerRecipientInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-share-drawer-recipient] input'
  );
}

/** The Share menu's frame on phones: a tall bottom drawer that opens with focus in its To field. */
export function ShareDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      closeOnOutsidePointerStrategy="pointerdown"
      onOutsidePointer={(event) => {
        // A pointer that dismisses the drawer unmounts it at once, so the
        // click ending that tap would land on whatever was beneath it.
        if (!event.defaultPrevented) blockNextClick();
      }}
      initialFocusEl={getShareDrawerRecipientInput() ?? undefined}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Share"
          class="h-[80vh] overflow-y-auto"
        >
          <div class="flex justify-center pt-3 pb-1 shrink-0">
            <div class="w-10 h-1 rounded-full bg-edge-muted" />
          </div>
          {props.children}
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** The Share drawer's title row, with its send button at the end. */
export function ShareDrawerHeader(props: {
  action?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="shrink-0 flex items-center justify-between px-3 text-sm font-medium text-ink min-h-11">
      <div class="flex items-center gap-1.5 flex-1 min-w-0">
        {props.children}
      </div>
      {props.action}
    </div>
  );
}

/** The send button at the end of the Share drawer's title row. */
export function ShareDrawerAction(props: {
  disabled: boolean;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0 ml-2 pl-2 disabled:text-ink-muted text-accent"
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.children}
    </Button>
  );
}
