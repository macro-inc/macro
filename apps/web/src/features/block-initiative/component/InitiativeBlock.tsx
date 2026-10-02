import { ViewBreadcrumbs } from '@app/components/view-shell';
import { ProjectDetail } from '@app/features/projects/project-detail';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { SidePanel } from '@components/app/side-panel';
import { RedirectSplit } from '@components/app/split-layout/split-router/app-route-shell';
import { useBlockId } from '@core/block';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableProjects } from '@core/constant/featureFlags';
import { ListEntityMetadataQueryProvider } from '@entity';
import { Show } from 'solid-js';

/** The block adapter: the only place that reads the block id. */
export default function InitiativeBlock() {
  return <InitiativeProject id={useBlockId()} />;
}

/**
 * The same project view the Tasks route renders, behind the Projects flag,
 * with the tag sets and breadcrumb root the Tasks view supplies there.
 */
export function InitiativeProject(props: { id: string }) {
  const flag = useFeatureFlag(enableProjects);
  const value = () => `initiative:${props.id}`;
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading} fallback={<LoadingBlock />}>
          <RedirectSplit to={{ type: 'component', id: 'tasks' }} />
        </Show>
      }
    >
      <ListEntityMetadataQueryProvider>
        <ViewBreadcrumbs.Root value={value()} onChange={() => {}}>
          <SidePanel.Root>
            <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
              <ProjectDetail
                route={{ id: props.id, section: 'overview' }}
                breadcrumb={{
                  entry: {
                    value: value(),
                    data: { type: 'initiative', id: props.id },
                  },
                  order: 0,
                }}
              />
            </div>
          </SidePanel.Root>
        </ViewBreadcrumbs.Root>
      </ListEntityMetadataQueryProvider>
    </Show>
  );
}
