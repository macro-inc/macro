import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableReminders } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import BellIcon from '@phosphor/bell-simple.svg';
import { useEmailFollowupQuery } from '@queries/reminders/email-followup';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { makeCreateReminderAction } from '../next-soup/actions/make-create-reminder-action';

/** App-facing status/action, mounted only when the reminder flag is enabled. */
export function EmailReminderStatus(props: {
  entity: EntityData;
  onSaved?: () => void | Promise<void>;
}) {
  const enabled = useFeatureFlag(enableReminders);
  return (
    <Show when={enabled().enabled}>
      <EmailReminderStatusContent {...props} />
    </Show>
  );
}
function EmailReminderStatusContent(props: {
  entity: EntityData;
  onSaved?: () => void | Promise<void>;
}) {
  const query = useEmailFollowupQuery(() => props.entity.id);
  const reminder = () => (query.isSuccess ? query.data : undefined);
  const pending = () =>
    reminder()?.state === 'pending' || reminder()?.state === 'archiving';
  const label = () =>
    pending()
      ? `Reminder set for ${new Date(reminder()!.remindAt).toLocaleString()}`
      : reminder()?.state === 'returned'
        ? 'Reminder returned — remind me again'
        : 'Remind me';
  const action = makeCreateReminderAction({ onEmailSaved: props.onSaved });
  return (
    <Button
      size="icon-md"
      label={label()}
      hotkey={TOKENS.entity.action.createReminder}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        action.execute([props.entity]);
      }}
    >
      <BellIcon
        class="size-4"
        classList={{
          'text-accent': pending() || reminder()?.state === 'returned',
        }}
      />
    </Button>
  );
}
