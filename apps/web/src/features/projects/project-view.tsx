import {
  projectDetailRoute,
  tasksProjectsRoute,
} from '@app/features/tasks-view/route';
import { useNavigate } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { onCleanup, onMount } from 'solid-js';
import { type ProjectRoute, projectRouteId } from './core/route';
import type { ProjectComposerDraft } from './primitives/create-project';
import { Projects } from './projects';
import { CreateProject } from './views/create-project';

export function ProjectsListView() {
  const navigate = useNavigate();
  onMount(() =>
    navigate(
      { route: tasksProjectsRoute, params: { projectsTab: 'projects' } },
      { replace: true }
    )
  );
  return null;
}

/** Project links restore the same Tasks workspace and breadcrumb navigation. */
export function ProjectView(props: { route: ProjectRoute }) {
  const navigate = useNavigate();
  onMount(() =>
    navigate(
      {
        route: projectDetailRoute,
        params: { projectId: props.route.id, section: props.route.section },
      },
      {
        replace: true,
        search: {
          tasks: { tab: ['projects'] },
          project: props.route.discussionId
            ? { discussionId: [props.route.discussionId] }
            : {},
        },
      }
    )
  );
  return null;
}

export function CreateProjectView(props: {
  initialDraft?: ProjectComposerDraft;
}) {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  onMount(() => panel.handle.setDisplayName('New project'));
  return (
    <Projects>
      <SplitPanel.Root class="bg-transparent">
        <SplitPanel.Body>
          <CreateProject
            initialDraft={props.initialDraft}
            onFailure={(initialDraft) => {
              // A native popover can close while a request is in flight.
              // Restore its failed draft just like the task composer does.
              if (disposed)
                layout.popoverSplit({
                  type: 'component',
                  id: 'project-compose',
                  params: { initialDraft },
                });
            }}
            onContinueInSplit={
              panel.handle.isPopover()
                ? (initialDraft) => {
                    layout.openWithSplit(
                      {
                        type: 'component',
                        id: 'project-compose',
                        params: { initialDraft },
                      },
                      { preferNewSplit: true }
                    );
                    panel.handle.close();
                  }
                : undefined
            }
            onClose={() => {
              if (panel.handle.isPopover()) {
                panel.handle.close();
                return;
              }
              layout.replaceSplit({
                content: { type: 'component', id: 'tasks-projects' },
              });
            }}
            onCreated={(id) => {
              if (panel.handle.isPopover()) panel.handle.close();
              layout.replaceSplit({
                content: {
                  type: 'component',
                  id: projectRouteId({ id, section: 'overview' }),
                },
              });
            }}
          />
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Projects>
  );
}
