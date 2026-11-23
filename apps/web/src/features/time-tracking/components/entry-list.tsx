import { formatLocale, t } from '@app/lib/i18n';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { dayName, groupByDay } from '../core/entry-days';
import { formatLength } from '../core/format-length';

type EntryListProps = {
  entries: readonly TimeEntryFieldsFragment[];
  /** The device's calendar day, `YYYY-MM-DD`. */
  today: string;
  /** The person who logged an entry: avatar and name. */
  person: (userId: string) => JSX.Element;
  /** Wraps one entry's row with the actions the view offers for it. */
  row?: (entry: TimeEntryFieldsFragment, content: JSX.Element) => JSX.Element;
  /** Controls placed at the end of an entry's row. */
  actions?: (entry: TimeEntryFieldsFragment) => JSX.Element;
};

function dayLabel(day: string, today: string): string {
  const name = dayName(day, today);
  if (name.kind === 'today') return t('timeTracking.today');
  if (name.kind === 'yesterday') return t('timeTracking.yesterday');
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(name.date);
}

function span(entry: TimeEntryFieldsFragment): string | undefined {
  if (!entry.startedAt || !entry.endedAt) return undefined;
  const format = new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  });
  return format.formatRange(new Date(entry.startedAt), new Date(entry.endedAt));
}

function EntryRow(props: {
  entry: TimeEntryFieldsFragment;
  person: (userId: string) => JSX.Element;
  actions?: (entry: TimeEntryFieldsFragment) => JSX.Element;
}): JSX.Element {
  const detail = () =>
    [
      span(props.entry),
      props.entry.source === 'TIMER'
        ? t('timeTracking.timerSource')
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <div class="flex items-center gap-2 px-2 py-1.5 text-sm touch:min-h-[44px]">
      <div class="shrink-0">{props.person(props.entry.userId)}</div>
      <div class="flex min-w-0 flex-1 flex-col">
        <Show when={props.entry.note}>
          {(note) => <span class="truncate text-ink">{note()}</span>}
        </Show>
        <Show when={detail()}>
          <span class="truncate text-xs text-ink-muted">{detail()}</span>
        </Show>
      </div>
      <span class="shrink-0 tabular-nums text-ink">
        {formatLength(props.entry.minutes)}
      </span>
      <Show when={props.actions}>{(actions) => actions()(props.entry)}</Show>
    </div>
  );
}

/** A task's entries by day, each day with its total, newest first. */
export function EntryList(props: EntryListProps): JSX.Element {
  const days = () => groupByDay(props.entries);
  return (
    <div class="flex flex-col gap-2">
      <For each={days()}>
        {(day) => (
          <section class="flex flex-col">
            <h3 class="px-2 py-1 text-xs font-medium text-ink-muted">
              {t('timeTracking.dayTotal', {
                day: dayLabel(day.day, props.today),
                length: formatLength(day.minutes),
              })}
            </h3>
            <For each={day.entries}>
              {(entry) => {
                const content = (
                  <EntryRow
                    entry={entry}
                    person={props.person}
                    actions={props.actions}
                  />
                );
                return (
                  <Switch fallback={content}>
                    <Match when={props.row}>
                      {(row) => row()(entry, content)}
                    </Match>
                  </Switch>
                );
              }}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}
