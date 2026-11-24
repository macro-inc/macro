import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { UserIcon } from '@core/component/UserIcon';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { downloadFile } from '@filesystem/download';
import { type JSX, Show, Suspense } from 'solid-js';
import { localDay } from './core/entry-days';
import type { ProjectTimeClock } from './primitives/create-project-time';
import { TimeTrackingProvider } from './time-tracking-provider';
import { MobileProjectTime } from './views/mobile/project-time';
import { ProjectTimeDesktop } from './views/project-time';

type ProjectTimeProps = {
  project: { id: string; name: string };
  /** Opens a task from a report row; returns whether it opened. */
  onOpenTask(
    task: { id: string },
    options?: EntityDetailNavigationOptions
  ): boolean;
};

function ReportPerson(props: { userId: string }): JSX.Element {
  const name = () => getDisplayName(tryMacroId(props.userId));
  return (
    <span class="flex min-w-0 items-center gap-2">
      <UserIcon
        id={props.userId}
        name={name()}
        size="sm"
        suppressClick
        showTooltip={false}
      />
      <span class="truncate">{name()}</span>
    </span>
  );
}

/** Days are this device's; weeks start as the calendar's preference says. */
function useProjectTimeClock(): ProjectTimeClock {
  const [preferences] = useCalendarPreferences();
  return {
    today: () => localDay(new Date()),
    weekStartsOn: () => preferences.weekStartsOn,
  };
}

function saveCsv(content: string, filename: string) {
  return downloadFile(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
    filename
  );
}

function reportProps(props: ProjectTimeProps) {
  return {
    get project() {
      return props.project;
    },
    clock: useProjectTimeClock(),
    person: (userId: string) => <ReportPerson userId={userId} />,
    onOpenTask: (taskId: string, options?: EntityDetailNavigationOptions) => {
      props.onOpenTask({ id: taskId }, options);
    },
  };
}

/** A project's Time tab on desktop and tablets, with the CSV export. */
export function ProjectTimeTab(props: ProjectTimeProps): JSX.Element {
  return (
    <Suspense>
      <TimeTrackingProvider>
        <ProjectTimeDesktop {...reportProps(props)} save={saveCsv} />
      </TimeTrackingProvider>
    </Suspense>
  );
}

/** A project's time on a phone's one-page project, behind `enable-time-tracking`. */
export function ProjectTimeEntry(props: ProjectTimeProps): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  return (
    <Show when={flag().enabled}>
      <Suspense>
        <TimeTrackingProvider>
          <MobileProjectTime {...reportProps(props)} />
        </TimeTrackingProvider>
      </Suspense>
    </Show>
  );
}
