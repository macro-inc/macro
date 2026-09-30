import { ProjectDetail } from '@app/features/projects/project-detail';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SidePanel } from '@components/app/side-panel';
import { RedirectSplit } from '@components/app/split-layout/split-router/app-route-shell';
import { useBlockId } from '@core/block';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableProjects } from '@core/constant/featureFlags';
import { Show } from 'solid-js';

/** The block adapter: the only place that reads the block id. */
export default function InitiativeBlock() {
  return <InitiativeProject id={useBlockId()} />;
}

/** The same project view the Tasks route renders, behind the Projects flag. */
export function InitiativeProject(props: { id: string }) {
  const flag = useFeatureFlag(enableProjects);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<LoadingBlock />}>
          <RedirectSplit to={{ type: 'component', id: 'tasks' }} />
        </Show>
      }
    >
      <SidePanel.Root>
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
          <ProjectDetail route={{ id: props.id, section: 'overview' }} />
        </div>
      </SidePanel.Root>
    </Show>
  );
}
