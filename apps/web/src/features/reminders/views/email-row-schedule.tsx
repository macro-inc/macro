import { ActionDialogShell, Dialog } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { ReminderScheduleIndicator } from '../components/reminder-schedule-indicator';
import type { EmailRowReminder } from '../context/email-row-reminders';
import { emailReminderScheduleLabel } from '../core/row-schedule';
import { useReminderClock } from '../primitives/reminder-clock';
import { ReminderDetails } from '../ReminderEditorSplit';

/** The email check remains owned by email. This control edits only its reminder. */
export function EmailRowSchedule(props: { reminder: EmailRowReminder }) {
  const now = useReminderClock();
  const [open, setOpen] = createSignal(false);
  // Summary polling may choose another nearest reminder while this editor is open.
  // The activation, not live row metadata, owns this editor session's identity.
  const [target, setTarget] = createSignal<{
    id: string;
    emailFollowup: boolean;
  }>();
  let opener: HTMLElement | undefined;
  const label = () => {
    const reminder = props.reminder.nearest;
    const schedule = emailReminderScheduleLabel(reminder, now());
    return `${schedule}${props.reminder.count > 1 ? ` · ${props.reminder.count - 1} more reminders` : ''}`;
  };
  return (
    <span
      class="contents"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      <ReminderScheduleIndicator
        label={label()}
        onEdit={() => {
          opener =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : undefined;
          setTarget({
            id: props.reminder.nearest.id,
            emailFollowup: !!props.reminder.nearest.emailFollowup,
          });
          setOpen(true);
        }}
      />
      <Show when={props.reminder.count > 1}>
        <span class="text-xs text-ink-extra-muted" aria-hidden="true">
          +{props.reminder.count - 1}
        </span>
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
          <Show when={open() && target()}>
            {(selected) => (
              <Suspense fallback={<p role="status">Loading reminder…</p>}>
                <ReminderDetails
                  reminderId={selected().id}
                  isEmailFollowup={selected().emailFollowup}
                  onClose={() => setOpen(false)}
                />
              </Suspense>
            )}
          </Show>
        </ActionDialogShell>
      </Dialog>
    </span>
  );
}
