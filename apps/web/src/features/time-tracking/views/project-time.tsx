import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import type { TimeGrouping } from '@service-storage/graphql/generated/graphql';
import { Button, Tabs } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { PeriodPicker } from '../components/period-picker';
import { TimeBreakdown } from '../components/time-breakdown';
import { TimeFigure } from '../components/time-figure';
import { formatLength } from '../core/format-length';
import {
  createProjectTime,
  createProjectTimeExport,
  createProjectWeekTime,
} from '../primitives/create-project-time';
import {
  BreakdownSkeleton,
  loggedInLabel,
  NoTimeLogged,
  reportExport,
  SummaryFailed,
  SummaryIncomplete,
} from './shared/project-time-parts';
import type { ProjectTimeViewProps } from './shared/project-time-props';

const UNAVAILABLE = '–';

/**
 * A project's Time tab: the period, its three figures, and the breakdown by
 * person, task or day with what each row holds; export for the period.
 */
function ProjectTimeDesktopBody(props: ProjectTimeViewProps): JSX.Element {
  const projectId = () => props.project.id;
  const time = createProjectTime(projectId, props.clock);
  const week = createProjectWeekTime(projectId, props.clock);
  const exporter = createProjectTimeExport(
    () => props.project,
    time.days,
    props.save
  );
  usePending('time.summary', time.pending, { 'project.id': props.project.id });
  const exportCsv = async () => reportExport(await exporter.run());
  // A figure whose read failed reads as a dash, not a placeholder that never ends.
  const minutes = (value: number | undefined, failed: boolean) => {
    if (value !== undefined) return formatLength(value);
    return failed ? UNAVAILABLE : undefined;
  };
  const tasksWithTime = () => {
    const summary = time.summary();
    if (!summary) return time.failed() ? UNAVAILABLE : undefined;
    if (summary.scopeTaskCount == null)
      return new Intl.NumberFormat(formatLocale()).format(summary.taskCount);
    return t('timeTracking.tasksWithTimeOf', {
      count: summary.taskCount,
      total: summary.scopeTaskCount,
    });
  };
  // A summary still on screen while the next grouping loads is labelled
  // by its own grouping, not by the tab just chosen.
  const shownGrouping = (): TimeGrouping =>
    time.summary()?.groups[0]?.key.by ?? time.grouping();
  return (
    <div class="flex size-full min-h-0 flex-col touch:pt-(--mobile-content-inset-top) touch:[&>*]:[--mobile-content-inset-top:0px]">
      <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 overflow-x-auto scrollbar-hidden px-4 py-2">
        <PeriodPicker value={time.period()} onChange={time.setPeriod} />
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <Tabs
            aria-label={t('timeTracking.groupBy')}
            size="md"
            touch="inset"
            options={[
              { value: 'PERSON', label: t('timeTracking.byPerson') },
              { value: 'TASK', label: t('timeTracking.byTask') },
              { value: 'DAY', label: t('timeTracking.byDay') },
            ]}
            value={time.grouping()}
            onChange={time.setGrouping}
          />
          <Button
            variant="secondary"
            size="md"
            disabled={exporter.pending()}
            onClick={() => fireAndForget(exportCsv(), 'time-tracking')}
          >
            <DownloadIcon class="size-4" />
            {t('timeTracking.exportCsv')}
          </Button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-8">
        <div class="mx-auto flex max-w-3xl flex-col gap-6">
          <div class="grid grid-cols-3 gap-6">
            <TimeFigure
              label={loggedInLabel(time, props.clock)}
              value={minutes(time.summary()?.totalMinutes, time.failed())}
            />
            <TimeFigure
              label={t('timeTracking.periodThisWeek')}
              value={minutes(week.minutes(), week.failed())}
            />
            <TimeFigure
              label={t('timeTracking.tasksWithTime')}
              value={tasksWithTime()}
            />
          </div>
          <Show when={time.summary()?.complete === false}>
            <SummaryIncomplete />
          </Show>
          <Switch>
            <Match when={time.failed()}>
              <SummaryFailed
                onRetry={() => fireAndForget(time.refetch(), 'time-tracking')}
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
                <TimeBreakdown
                  groups={summary().groups}
                  grouping={shownGrouping()}
                  person={props.person}
                  onOpenTask={props.onOpenTask}
                />
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}

/** Each project starts its reads afresh: one project's totals never show under another's name. */
export function ProjectTimeDesktop(props: ProjectTimeViewProps): JSX.Element {
  return (
    <Show when={props.project.id} keyed>
      {(projectId) => (
        <ProjectTimeDesktopBody
          {...props}
          project={{ id: projectId, name: props.project.name }}
        />
      )}
    </Show>
  );
}
