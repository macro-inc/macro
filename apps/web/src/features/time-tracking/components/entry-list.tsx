import { formatLocale, t } from '@app/lib/i18n';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { Key } from '@solid-primitives/keyed';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { dayName, groupByDay } from '../core/entry-days';
import { formatLength } from '../core/format-length';

/** Who logged an entry, as the host shows people: a picture and a name. */
export type EntryPerson = {
  avatar: (userId: string) => JSX.Element;
  name: (userId: string) => string;
};

type EntryListProps = {
  entries: readonly TimeEntryFieldsFragment[];
  /** The device's calendar day, `YYYY-MM-DD`. */
  today: string;
  person: EntryPerson;
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

/**
 * An entry's note, wrapped like a comment's body and cut to three lines, with
 * Show more when it runs past them.
 */
function EntryNote(props: { text: string }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let ref: HTMLParagraphElement | undefined;
  // Expanded, the box is as tall as its text and would always read as fitting.
  const measure = () => {
    if (ref && !expanded())
      setOverflowing(ref.scrollHeight > ref.clientHeight + 1);
  };
  createEffect(on(() => props.text, measure));
  onMount(() => createResizeObserver(() => ref, measure));
  return (
    <div class="flex min-w-0 flex-col items-start">
      <p
        ref={ref}
        class="w-full whitespace-pre-wrap text-base text-ink wrap-anywhere"
        classList={{ 'line-clamp-3': !expanded() }}
      >
        {props.text}
      </p>
      <Show when={overflowing()}>
        {/* Above the phone sheet's row-wide edit button. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="relative z-1 -ml-1.5"
          aria-expanded={expanded()}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded() ? t('common.showLess') : t('common.showMore')}
        </Button>
      </Show>
    </div>
  );
}

/**
 * One entry, read like a comment: the person, then the name with when and how
 * it was logged, its length and menu on that line, and the note under the name.
 */
function EntryRow(props: {
  entry: TimeEntryFieldsFragment;
  person: EntryPerson;
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
    <div class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] content-center items-center gap-x-2 gap-y-1 px-2 py-1.5 text-sm touch:min-h-[44px]">
      <div class="flex shrink-0">{props.person.avatar(props.entry.userId)}</div>
      <div class="flex min-w-0 items-baseline gap-1">
        <span class="min-w-0 shrink-[100] truncate font-medium text-ink">
          {props.person.name(props.entry.userId)}
        </span>
        <Show when={detail()}>
          <span class="min-w-0 max-w-[calc(100%-3rem)] truncate text-xs text-ink-extra-muted tabular-nums">
            {detail()}
          </span>
        </Show>
      </div>
      <div class="flex items-center gap-1">
        <span class="shrink-0 tabular-nums text-ink">
          {formatLength(props.entry.minutes)}
        </span>
        <Show when={props.actions}>
          {(actions) => (
            <div class="flex size-7 shrink-0 items-center justify-center">
              {actions()(props.entry)}
            </div>
          )}
        </Show>
      </div>
      <Show when={props.entry.note}>
        {(note) => (
          <div class="col-start-2 col-end-4 min-w-0">
            <EntryNote text={note()} />
          </div>
        )}
      </Show>
    </div>
  );
}

/** A task's entries by day, each day with its total, newest first. */
export function EntryList(props: EntryListProps): JSX.Element {
  const days = () => groupByDay(props.entries);
  return (
    <div class="flex flex-col gap-2">
      <Key each={days()} by={(day) => day.day}>
        {(day) => (
          <section class="flex flex-col">
            <h3 class="px-2 py-1 text-xs font-medium text-ink-muted">
              {t('timeTracking.dayTotal', {
                day: dayLabel(day().day, props.today),
                length: formatLength(day().minutes),
              })}
            </h3>
            <Key each={day().entries} by={(entry) => entry.id}>
              {(entry) => {
                const content = (
                  <EntryRow
                    entry={entry()}
                    person={props.person}
                    actions={props.actions}
                  />
                );
                return (
                  <Switch fallback={content}>
                    <Match when={props.row}>
                      {(row) => row()(entry(), content)}
                    </Match>
                  </Switch>
                );
              }}
            </Key>
          </section>
        )}
      </Key>
    </div>
  );
}
