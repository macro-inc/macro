import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import X from '@phosphor/x.svg';
import { Button, Dialog } from '@ui';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { createSignal, Show } from 'solid-js';
import { EventReview } from '../components/event-review';
import { SchedulingDrawerHeader } from '../components/scheduling-drawer-header';
import type {
  AvailabilitySchedule,
  EventType,
  SchedulingMember,
} from '../core/types';

type EventDetailsDialogProps = {
  event: EventType;
  link: string;
  schedule?: AvailabilitySchedule;
  members: SchedulingMember[];
  team: boolean;
  saving: boolean;
  opener?: HTMLElement;
  onCopyLink: () => Promise<void>;
  onClose: () => void;
  onEdit?: (event: EventType, opener?: HTMLElement) => void;
};

export function EventDetailsDialog(props: EventDetailsDialogProps) {
  const [open, setOpen] = createSignal(true);
  const active = () => props.event.enabled && !props.event.requiresConfirmation;
  let editing: EventType | undefined;
  let finished = false;
  const close = () => {
    if (!open()) return;
    setOpen(false);
    if (!isTouchDevice()) props.onClose();
  };
  const finishClose = () => {
    if (open() || finished) return;
    finished = true;
    const next = editing;
    editing = undefined;
    if (isTouchDevice()) props.onClose();
    // Release the details focus trap before opening the editor or focusing the row.
    queueMicrotask(() => {
      if (next) props.onEdit?.(next, props.opener);
      else if (props.opener?.isConnected)
        props.opener.focus({ preventScroll: true });
    });
  };
  const edit = () => {
    if (!props.onEdit || props.saving) return;
    editing = props.event;
    close();
  };
  const review = () => (
    <EventReview
      draft={props.event}
      link={props.link}
      schedule={props.schedule}
      members={props.members}
      team={props.team}
      active={active()}
      saving={props.saving}
      onCopyLink={active() ? props.onCopyLink : undefined}
    />
  );
  const editButton = () => (
    <Button
      type="button"
      variant="strong"
      size="lg"
      depth={2}
      class="touch:w-full"
      disabled={props.saving}
      onClick={edit}
    >
      Edit booking link
    </Button>
  );

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dialog
          open={open()}
          onOpenChange={(next) => !next && close()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            finishClose();
          }}
          position="center"
          animate
          class="w-full max-w-[min(42rem,calc(100vw-16px))] overflow-hidden"
        >
          <ActionDialogShell class="max-h-[calc(100dvh-16px)]">
            <div class="flex shrink-0 items-center justify-between gap-3 border-b border-edge-divider px-5 py-4">
              <Dialog.Title class="text-lg font-semibold">
                Booking link details
              </Dialog.Title>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                label="Close booking link details"
                tooltipDisabled
                onClick={close}
              >
                <X class="size-4" aria-hidden="true" />
              </Button>
            </div>
            <ActionDialogShell.Body>{review()}</ActionDialogShell.Body>
            <Show when={props.onEdit}>
              <ActionDialogShell.Footer>
                {editButton()}
              </ActionDialogShell.Footer>
            </Show>
          </ActionDialogShell>
        </Dialog>
      }
    >
      <MobileDrawer
        side="bottom"
        open={open()}
        onOpenChange={(next) => !next && close()}
        onContentPresentChange={(present) => {
          if (!present) queueMicrotask(finishClose);
        }}
        restoreFocus={false}
        noOutsidePointerEvents
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Booking link details">
            <MobileDrawer.Handle class="pb-1" />
            <SchedulingDrawerHeader
              title="Booking link details"
              closeLabel="Close booking link details"
              onClose={close}
            />
            <MobileDrawer.ScrollBody
              data-corvu-no-drag
              class="touch-pan-y overscroll-contain px-6 pb-4"
            >
              {review()}
            </MobileDrawer.ScrollBody>
            <Show when={props.onEdit}>
              <footer class="shrink-0 border-t border-edge-divider px-6 pt-3 pb-[max(16px,var(--mobile-sheet-safe-padding))]">
                {editButton()}
              </footer>
            </Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}
