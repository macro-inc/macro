import { MobileDrawer } from '@app/components/app/mobile/MobileDrawer';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { PeriodPicker } from '../../components/period-picker';
import type { OpenReportTask } from '../../components/time-breakdown';
import { BreakdownList } from '../../components/time-breakdown';
import { TimeKeyLabel } from '../../components/time-key-label';
import type { TimeSummaryTotal } from '../../components/time-summary-types';
import { formatLength } from '../../core/format-length';
import { createProjectTime } from '../../primitives/create-project-time';
import {
  BreakdownSkeleton,
  loggedInLabel,
  NoTimeLogged,
  SummaryFailed,
  SummaryIncomplete,
} from '../shared/project-time-parts';
import type { ProjectTimeViewProps } from '../shared/project-time-props';

/** The tasks with the most time, each opening its task. */
function MostTime(props: {
  totals: readonly TimeSummaryTotal[];
  onOpenTask: OpenReportTask;
}): JSX.Element {
  return (
    <ul class="py-1">
      <For each={props.totals}>
        {(total) => (
          <li>
            <button
              type="button"
              data-press-surface
              disabled={!total.key.taskId}
              class="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm"
              onClick={(event) => {
                if (total.key.taskId)
                  props.onOpenTask(total.key.taskId, { event });
              }}
            >
              <span class="flex min-w-0 flex-1 items-center">
                <TimeKeyLabel timeKey={total.key} person={() => null} />
              </span>
              <span class="shrink-0 tabular-nums">
                {formatLength(total.minutes)}
              </span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}

/**
 * A project's time on a phone: one row on the project page that opens a
 * sheet stacking the period, its total, its people (each opening to their
 * tasks) and the tasks with the most time. Export stays on desktop.
 */
export function MobileProjectTime(
  props: Omit<ProjectTimeViewProps, 'save'>
): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const time = createProjectTime(() => props.project.id, props.clock);
  usePending('time.summary', time.pending, { 'project.id': props.project.id });
  const total = () => {
    const summary = time.summary();
    return summary ? formatLength(summary.totalMinutes) : undefined;
  };
  const tasks = () =>
    (time.summary()?.thenTotals ?? []).filter((task) => task.minutes > 0);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(true)}
        class="flex min-h-[44px] w-full items-center gap-3 rounded-3xl bg-ink/5 p-3 text-left text-sm"
      >
        <ClockIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-ink-muted">
          {loggedInLabel(time, props.clock)}
        </span>
        <Show when={total()} fallback={<ListSkeleton.Bar class="h-3 w-14" />}>
          {(value) => (
            <span class="shrink-0 font-medium tabular-nums">{value()}</span>
          )}
        </Show>
        <CaretRightIcon class="size-4 shrink-0 text-ink-muted" />
      </button>
      <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content maxHeight={90}>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-4 pb-2 text-base font-medium text-ink">
              {t('timeTracking.popoverTitle')}
            </MobileDrawer.Title>
            <div
              class="flex shrink-0 items-center px-4 pb-3"
              data-corvu-no-drag
            >
              <PeriodPicker value={time.period()} onChange={time.setPeriod} />
            </div>
            <MobileDrawer.ScrollBody class="flex flex-col gap-4 px-2 pb-6">
              <div class="flex flex-col gap-1 px-2">
                <span class="text-xs text-ink-muted">
                  {loggedInLabel(time, props.clock)}
                </span>
                <Show
                  when={total()}
                  fallback={<ListSkeleton.Bar class="my-1 h-6 w-24" />}
                >
                  {(value) => (
                    <span class="text-2xl font-semibold tabular-nums">
                      {value()}
                    </span>
                  )}
                </Show>
              </div>
              <Show when={time.summary()?.complete === false}>
                <div class="px-2">
                  <SummaryIncomplete />
                </div>
              </Show>
              <Switch>
                <Match when={time.failed()}>
                  <SummaryFailed
                    onRetry={() =>
                      fireAndForget(time.refetch(), 'time-tracking')
                    }
                  />
                </Match>
                <Match when={time.pending()}>
                  <BreakdownSkeleton />
                </Match>
                <Match when={time.summary()?.groups.length === 0}>
                  <NoTimeLogged />
                </Match>
                <Match when={time.summary()}>
                  {(summary) => (
                    <>
                      <section aria-label={t('timeTracking.byPersonHeading')}>
                        <h3 class="px-2 text-xs font-medium text-ink-muted">
                          {t('timeTracking.byPersonHeading')}
                        </h3>
                        <BreakdownList
                          groups={summary().groups}
                          person={props.person}
                          onOpenTask={props.onOpenTask}
                        />
                      </section>
                      <Show when={tasks().length > 0}>
                        <section aria-label={t('timeTracking.mostTime')}>
                          <h3 class="px-2 text-xs font-medium text-ink-muted">
                            {t('timeTracking.mostTime')}
                          </h3>
                          <MostTime
                            totals={tasks()}
                            onOpenTask={props.onOpenTask}
                          />
                        </section>
                      </Show>
                    </>
                  )}
                </Match>
              </Switch>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </>
  );
}
