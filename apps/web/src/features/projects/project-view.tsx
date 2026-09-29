import {
  projectDetailRoute,
  tasksProjectsRoute,
} from '@app/features/tasks-view/route';
import { useNavigate, useSplitHistory } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { type ProjectRoute, projectRouteId } from './core/route';
import type { ProjectComposerDraft } from './primitives/create-project';
import { Projects } from './projects';
import { CreateProject } from './views/create-project';

/** A split opened moments ago joins the router after it mounts; earlier navigation is dropped. */
function useRedirectOnceRouted(redirect: () => void) {
  const routed = useSplitHistory();
  let redirected = false;
  createEffect(() => {
    if (redirected || !routed()) return;
    redirected = true;
    redirect();
  });
}

export function ProjectsListView() {
  const navigate = useNavigate();
  useRedirectOnceRouted(() =>
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
  useRedirectOnceRouted(() =>
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
              // Submitting closes the composer before the server answers.
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
              // Runs once the server confirms, after submitting closed the
              // composer: a popover's project opens beside the current view,
              // and a split's replaces the Projects list it returned to.
              const content = {
                type: 'component' as const,
                id: projectRouteId({ id, section: 'overview' }),
              };
              if (panel.handle.isPopover()) {
                panel.handle.close();
                layout.openWithSplit(content, { preferNewSplit: true });
                return;
              }
              layout.replaceSplit({ content });
            }}
          />
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Projects>
  );
}
