import { ReminderScheduleIndicator } from '../components/reminder-schedule-indicator';
import type { EmailRowReminder } from '../core/email-row-reminder';
import { emailReminderScheduleLabel } from '../core/row-schedule';
import { useReminderClock } from '../primitives/reminder-clock';
import { openReminderComposer } from '../reminder-composer';

export function EmailRowSchedule(props: { reminder: EmailRowReminder }) {
  const now = useReminderClock();
  const edit = () => {
    const reminder = props.reminder.nearest;
    const reference = reminder.referencedEntity;
    if (reference?.type !== 'email') return;
    openReminderComposer({
      type: 'email',
      id: reference.id,
      name: reminder.name,
    });
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
        label={emailReminderScheduleLabel(props.reminder.nearest, now())}
        onEdit={edit}
      />
    </span>
  );
}
