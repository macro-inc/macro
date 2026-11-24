import { formatLocale, t } from '@app/lib/i18n';
import { parseISO } from 'date-fns';
import { type JSX, Match, Switch } from 'solid-js';
import type { TimeSummaryKey } from './time-summary-types';

/** The person who logged time: avatar and name. */
export type PersonLabel = (userId: string) => JSX.Element;

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseISO(date));
}

/** Who, what or when a total is for. */
export function TimeKeyLabel(props: {
  timeKey: TimeSummaryKey;
  person: PersonLabel;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.timeKey.by === 'PERSON' && props.timeKey.userId}>
        {(userId) => props.person(userId())}
      </Match>
      <Match when={props.timeKey.by === 'TASK'}>
        <span class="truncate">
          {props.timeKey.task?.name || t('timeTracking.untitledTask')}
        </span>
      </Match>
      <Match when={props.timeKey.by === 'DAY' && props.timeKey.date}>
        {(date) => <span class="truncate">{dayLabel(date())}</span>}
      </Match>
    </Switch>
  );
}

/** One identity per key, to remember which rows are open. */
export function timeKeyId(key: TimeSummaryKey): string {
  return `${key.by}:${key.userId ?? key.taskId ?? key.date ?? ''}`;
}
