import { ReminderTitle } from '../../extractors/reminder-title';
import type { ReminderEntity } from '../../types/entity';

export function ReminderWideContent(props: { entity: ReminderEntity }) {
  return <ReminderTitle entity={props.entity} showNote />;
}
