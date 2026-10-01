import type { ReminderEntity } from '@entity';
import CheckIcon from '@phosphor/check.svg';
import CircleIcon from '@phosphor/circle.svg';
import { ActionDialogShell, Button, Dialog } from '@ui';
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
    <>
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
            aria-pressed={done()}
            onClick={() => void toggle()}
          >
            <Show when={done()} fallback={<CircleIcon class="size-4" />}>
              <CheckIcon class="size-4" />
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
          <ActionDialogShell.Header>
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
    </>
  );
}
