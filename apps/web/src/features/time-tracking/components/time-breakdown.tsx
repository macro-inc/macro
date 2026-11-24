import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { t } from '@app/lib/i18n';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import type { TimeGrouping } from '@service-storage/graphql/generated/graphql';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { formatLength } from '../core/format-length';
import { type PersonLabel, TimeKeyLabel, timeKeyId } from './time-key-label';
import type { TimeSummaryGroup, TimeSummaryTotal } from './time-summary-types';

/** Opens a task from a report row; the event carries shift-click. */
export type OpenReportTask = (
  taskId: string,
  options?: EntityDetailNavigationOptions
) => void;

type BreakdownProps = {
  groups: readonly TimeSummaryGroup[];
  grouping: TimeGrouping;
  person: PersonLabel;
  onOpenTask: OpenReportTask;
};

function groupingName(grouping: TimeGrouping): string {
  if (grouping === 'PERSON') return t('timeTracking.byPerson');
  if (grouping === 'TASK') return t('timeTracking.byTask');
  return t('timeTracking.byDay');
}

function breakdownLabel(grouping: TimeGrouping): string {
  if (grouping === 'PERSON') return t('timeTracking.timeByPerson');
  if (grouping === 'TASK') return t('timeTracking.timeByTask');
  return t('timeTracking.timeByDay');
}

/** The length, right-aligned in the time column. */
function Length(props: { minutes: number }): JSX.Element {
  return (
    <span class="shrink-0 text-right tabular-nums">
      {formatLength(props.minutes)}
    </span>
  );
}

/** A row under a group: a task opens; a person or a day only reads. */
function BreakdownRow(props: {
  total: TimeSummaryTotal;
  person: PersonLabel;
  onOpenTask: OpenReportTask;
  /** Keeps the time column in line with groups that carry an Open action. */
  reserveAction: boolean;
}): JSX.Element {
  const content = () => (
    <>
      <span class="flex min-w-0 flex-1 items-center gap-2">
        <TimeKeyLabel timeKey={props.total.key} person={props.person} />
      </span>
      <Length minutes={props.total.minutes} />
      <Show when={props.reserveAction}>
        <span class="size-6 shrink-0" aria-hidden="true" />
      </Show>
    </>
  );
  return (
    <li>
      <Show
        when={props.total.key.by === 'TASK' && props.total.key.taskId}
        fallback={
          <div class="flex min-h-9 items-center gap-2 py-1 pr-2 pl-9 text-sm text-ink-muted touch:min-h-[44px]">
            {content()}
          </div>
        }
      >
        {(taskId) => (
          <button
            type="button"
            data-press-surface
            class="flex min-h-9 w-full items-center gap-2 rounded-md py-1 pr-2 pl-9 text-left text-sm text-ink-muted not-touch:hover:bg-hover touch:min-h-[44px]"
            onClick={(event) => props.onOpenTask(taskId(), { event })}
          >
            {content()}
          </button>
        )}
      </Show>
    </li>
  );
}

function BreakdownGroup(props: {
  group: TimeSummaryGroup;
  open: boolean;
  onToggle(): void;
  person: PersonLabel;
  onOpenTask: OpenReportTask;
}): JSX.Element {
  const taskId = () =>
    props.group.key.by === 'TASK' ? props.group.key.taskId : null;
  return (
    <li>
      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={props.open}
          data-press-surface
          class="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm not-touch:hover:bg-hover touch:min-h-[44px]"
          onClick={() => props.onToggle()}
        >
          <CaretRightIcon
            class={cn(
              'size-3.5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none',
              props.open && 'rotate-90'
            )}
          />
          <span class="flex min-w-0 flex-1 items-center gap-2 font-medium">
            <TimeKeyLabel timeKey={props.group.key} person={props.person} />
          </span>
          <Show when={props.group.key.by !== 'TASK'}>
            <span class="shrink-0 text-xs text-ink-muted">
              {t('timeTracking.taskCount', { count: props.group.taskCount })}
            </span>
          </Show>
          <Length minutes={props.group.minutes} />
        </button>
        <Show when={taskId()}>
          {(id) => (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('timeTracking.openTaskNamed', {
                task:
                  props.group.key.task?.name || t('timeTracking.untitledTask'),
              })}
              tooltip={t('timeTracking.openTask')}
              onClick={(event) => props.onOpenTask(id(), { event })}
            >
              <ArrowSquareOutIcon class="size-3.5" />
            </Button>
          )}
        </Show>
      </div>
      <Show when={props.open}>
        <ul>
          <For each={props.group.rows}>
            {(total) => (
              <BreakdownRow
                total={total}
                person={props.person}
                onOpenTask={props.onOpenTask}
                reserveAction={props.group.key.by === 'TASK'}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** Groups that open to their rows; each list remembers its own open rows. */
export function BreakdownList(props: {
  groups: readonly TimeSummaryGroup[];
  person: PersonLabel;
  onOpenTask: OpenReportTask;
}): JSX.Element {
  const [open, setOpen] = createSignal<string[]>([]);
  const toggle = (id: string) =>
    setOpen((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]
    );
  return (
    <ul class="py-1">
      <For each={props.groups}>
        {(group) => (
          <BreakdownGroup
            group={group}
            open={open().includes(timeKeyId(group.key))}
            onToggle={() => toggle(timeKeyId(group.key))}
            person={props.person}
            onOpenTask={props.onOpenTask}
          />
        )}
      </For>
    </ul>
  );
}

/**
 * A report's totals by its first grouping under a column header, each row
 * opening to the second. Rows come in the server's order.
 */
export function TimeBreakdown(props: BreakdownProps): JSX.Element {
  return (
    <section aria-label={breakdownLabel(props.grouping)}>
      <div class="flex h-8 items-center gap-2 border-b border-edge-muted px-2 text-xs text-ink-muted">
        <span class="flex-1 pl-5.5">{groupingName(props.grouping)}</span>
        <span>{t('timeTracking.timeColumn')}</span>
        <Show when={props.grouping === 'TASK'}>
          <span class="size-6 shrink-0" aria-hidden="true" />
        </Show>
      </div>
      <BreakdownList
        groups={props.groups}
        person={props.person}
        onOpenTask={props.onOpenTask}
      />
    </section>
  );
}
