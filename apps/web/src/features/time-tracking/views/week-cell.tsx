import { formatLocale, t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import { Popover } from '@kobalte/core/popover';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { Button, Dropdown, Input } from '@ui';
import { parseISO } from 'date-fns';
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import { EntryForm } from '../components/entry-form';
import { EntryList } from '../components/entry-list';
import type { PersonLabel } from '../components/time-key-label';
import { GridLength } from '../components/week-grid';
import { useTimeTracking } from '../context/time-tracking-context';
import { formatLength } from '../core/format-length';
import { MAX_ENTRY_MINUTES, parseLength } from '../core/parse-length';
import { createTaskTime } from '../primitives/create-task-time';
import type { TimeWriteResult } from '../queries/write-result';
import { reportWrite } from './shared/report-write';
import type { TaskEditAccess } from './shared/tasks-time-props';

type CellProps = {
  taskId: string;
  taskName: string;
  day: string;
  today: string;
  minutes: number | undefined;
  person: PersonLabel;
  editAccess: TaskEditAccess;
  /** After a write lands, so the week reads it again at once. */
  onWritten(): void;
};

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseISO(day));
}

/** The open cell: that day's entries for the task and a length to log. */
function CellEntries(props: CellProps): JSX.Element {
  const [editing, setEditing] = createSignal<TimeEntryFieldsFragment>();
  const [draft, setDraft] = createSignal('');
  const time = createTaskTime(() => props.taskId);
  const { viewerId } = useTimeTracking();
  const entries = () =>
    time
      .entries()
      .filter(
        (entry) => entry.date === props.day && entry.userId === viewerId()
      );
  const listed = () => entries().reduce((sum, entry) => sum + entry.minutes, 0);
  const parsed = () => (draft().trim() ? parseLength(draft()) : undefined);
  const written = async (write: Promise<TimeWriteResult>, failure: string) => {
    reportWrite(write, failure);
    if ((await write).isOk()) props.onWritten();
  };
  const log = () => {
    const length = parsed();
    if (length?.kind !== 'length') return;
    setDraft('');
    fireAndForget(
      written(
        time.log({
          date: props.day,
          minutes: length.minutes,
          note: null,
          startedAt: null,
          endedAt: null,
        }),
        t('timeTracking.saveFailed')
      ),
      'time-tracking'
    );
  };
  const actions = (entry: TimeEntryFieldsFragment) => (
    <Show when={entry.canEdit}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          aria-label={t('timeTracking.entryActions')}
        >
          <DotsThreeIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-40">
          <Dropdown.Item onSelect={() => setEditing(entry)}>
            {t('timeTracking.editEntry')}
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() =>
              fireAndForget(
                written(time.remove(entry), t('timeTracking.deleteFailed')),
                'time-tracking'
              )
            }
          >
            {t('timeTracking.deleteEntry')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
  return (
    <Switch>
      <Match when={editing()}>
        {(entry) => (
          <EntryForm
            initial={entry()}
            submitLabel={t('timeTracking.save')}
            onCancel={() => setEditing(undefined)}
            onSubmit={(values) => {
              const edited = entry();
              setEditing(undefined);
              fireAndForget(
                written(
                  time.update(edited, values),
                  t('timeTracking.saveFailed')
                ),
                'time-tracking'
              );
            }}
          />
        )}
      </Match>
      <Match when={!editing()}>
        {props.editAccess(props.taskId, (canEdit) => (
          <Show when={canEdit() !== false}>
            <form
              class="px-1"
              onSubmit={(event) => {
                event.preventDefault();
                log();
              }}
            >
              <Input
                aria-label={t('timeTracking.inputLabel')}
                placeholder={t('timeTracking.inputPlaceholder')}
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
            </form>
            <Show when={parsed()?.kind === 'invalid'}>
              <p class="px-2 text-xs text-ink-muted">
                {t('timeTracking.unreadable')}
              </p>
            </Show>
            <Show when={parsed()?.kind === 'too-long'}>
              <p class="px-2 text-xs text-failure">
                {t('timeTracking.tooLong', {
                  hours: MAX_ENTRY_MINUTES / 60,
                })}
              </p>
            </Show>
          </Show>
        ))}
        <Show
          when={!time.pending()}
          fallback={
            <p role="status" class="px-2 py-1 text-xs text-ink-muted">
              {t('timeTracking.loadingEntries')}
            </p>
          }
        >
          <EntryList
            entries={entries()}
            today={props.today}
            person={props.person}
            actions={actions}
          />
          <Show when={time.hasOlder() && listed() < (props.minutes ?? 0)}>
            <Button
              variant="ghost"
              size="sm"
              class="self-start"
              disabled={time.olderPending()}
              onClick={() => time.showOlder()}
            >
              {t('timeTracking.showOlder')}
            </Button>
          </Show>
        </Show>
      </Match>
    </Switch>
  );
}

/**
 * One task's time on one day in My week. Opening it lists that day's entries
 * and takes a length to log another, as a task's Time popover does: typing
 * never overwrites what is there.
 */
export function WeekCell(props: CellProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const label = () =>
    props.minutes
      ? t('timeTracking.cellLabel', {
          length: formatLength(props.minutes),
          task: props.taskName,
          day: dayLabel(props.day),
        })
      : t('timeTracking.cellEmptyLabel', {
          task: props.taskName,
          day: dayLabel(props.day),
        });
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-end"
      gutter={4}
      fitViewport
    >
      <Popover.Trigger
        aria-label={label()}
        class="h-8 w-full rounded-md px-1 text-right not-touch:hover:bg-hover"
      >
        <GridLength minutes={props.minutes} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-modal flex max-h-[min(480px,calc(100dvh-24px))] w-72 flex-col gap-1 overflow-y-auto p-1 outline-none">
          <Popover.Title class="truncate px-2 pt-1 text-xs font-medium text-ink-muted">
            {t('timeTracking.cellTitle', {
              task: props.taskName,
              day: dayLabel(props.day),
            })}
          </Popover.Title>
          <Show when={open()}>
            <CellEntries {...props} />
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
