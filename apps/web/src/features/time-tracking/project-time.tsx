import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { type JSX, Show, Suspense } from 'solid-js';
import { ReportPerson, saveCsv, useReportClock } from './report-host';
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

function reportProps(props: ProjectTimeProps) {
  return {
    get project() {
      return props.project;
    },
    clock: useReportClock(),
    person: (userId: string) => <ReportPerson userId={userId} />,
    onOpenTask: (taskId: string, options?: EntityDetailNavigationOptions) => {
      props.onOpenTask({ id: taskId }, options);
    },
  };
}

/** A project's Time tab on desktop and tablets, with the CSV export. */
export function ProjectTimeTab(props: ProjectTimeProps): JSX.Element {
  const view = reportProps(props);
  return (
    <Suspense>
      <TimeTrackingProvider>
        <ProjectTimeDesktop {...view} save={saveCsv} />
      </TimeTrackingProvider>
    </Suspense>
  );
}

/** A project's time on a phone's one-page project, behind `enable-time-tracking`. */
export function ProjectTimeEntry(props: ProjectTimeProps): JSX.Element {
  const flag = useFeatureFlag(enableTimeTracking);
  const view = reportProps(props);
  return (
    <Show when={flag().enabled}>
      <Suspense>
        <TimeTrackingProvider>
          <MobileProjectTime {...view} />
        </TimeTrackingProvider>
      </Suspense>
    </Show>
  );
}
