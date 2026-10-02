import type { ReminderEntity } from '@entity';
import ArrowCounterClockwiseIcon from '@phosphor/arrow-counter-clockwise.svg';
import CheckIcon from '@phosphor/check.svg';
import { ActionDialogShell, Button, cn, Dialog } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { ReminderScheduleIndicator } from '../components/reminder-schedule-indicator';
import {
  reminderScheduleLabel,
  reminderScheduleState,
} from '../core/row-schedule';
import { useReminderClock } from '../primitives/reminder-clock';
import { ReminderDetails } from '../ReminderEditorSplit';

/** The editor is loaded only on demand; rendering a clock performs no query. */
export function ReminderRowSchedule(props: {
  entity: ReminderEntity;
  onToggleDone?: () => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  let opener: HTMLElement | undefined;
  const openEditor = () => {
    opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setOpen(true);
  };
  const now = useReminderClock();
  const state = () => reminderScheduleState(props.entity, now());
  const done = () => props.entity.completedAt != null;
  const reschedule = () => done() && !!props.entity.emailFollowup;
  const toggle = async () => {
    if (pending()) return;
    if (reschedule()) {
      openEditor();
      return;
    }
    setPending(true);
    try {
      await props.onToggleDone?.();
    } catch {
      /* The collection action owns failure feedback. */
    } finally {
      setPending(false);
    }
  };
  return (
    <span
      class="contents"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      <Show when={props.onToggleDone || done()}>
        <span
          class="inline-flex shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
        >
          <Button
            size="icon-sm"
            disabled={pending() || (!props.onToggleDone && !reschedule())}
            label={
              reschedule()
                ? 'Done — remind me again'
                : done()
                  ? 'Mark reminder not done'
                  : 'Mark reminder done'
            }
            class={cn(
              'text-ink-extra-muted',
              !done() &&
                'not-touch:opacity-0 not-touch:pointer-events-none group-hover/entity:opacity-100 group-hover/entity:pointer-events-auto group-focus-within/entity:opacity-100 group-focus-within/entity:pointer-events-auto'
            )}
            aria-busy={pending()}
            onClick={() => void toggle()}
          >
            <Show when={done()} fallback={<CheckIcon class="size-4" />}>
              <CheckIcon class="size-4 touch:hidden group-hover/entity:hidden group-focus-within/entity:hidden" />
              <span class="hidden touch:inline-flex group-hover/entity:inline-flex group-focus-within/entity:inline-flex">
                <ArrowCounterClockwiseIcon class="size-4" />
              </span>
            </Show>
          </Button>
        </span>
      </Show>
      <Show when={state() !== 'completed'}>
        <ReminderScheduleIndicator
          label={reminderScheduleLabel(props.entity, now())}
          onEdit={openEditor}
        />
      </Show>
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
        position="center"
        class="w-[calc(100vw-2rem)] max-w-110"
      >
        <ActionDialogShell>
          <ActionDialogShell.Header class="px-6 pt-5">
            <ActionDialogShell.Title>Reminder</ActionDialogShell.Title>
          </ActionDialogShell.Header>
          <Show when={open()}>
            <Suspense fallback={<p role="status">Loading reminder…</p>}>
              <ReminderDetails
                reminderId={props.entity.id}
                isEmailFollowup={!!props.entity.emailFollowup}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          </Show>
        </ActionDialogShell>
      </Dialog>
    </span>
  );
}
