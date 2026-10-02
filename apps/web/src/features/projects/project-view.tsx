import {
  projectDetailRoute,
  tasksProjectsRoute,
} from '@app/features/tasks-view/route';
import { useNavigate, useSplitHistory } from '@app/lib/split-router';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import SplitIcon from '@phosphor/square-half.svg';
import { createEffect, onMount } from 'solid-js';
import type { ProjectDetail } from './core/project';
import { type ProjectRoute, projectRouteId } from './core/route';
import {
  failedProjectDraft,
  type ProjectComposerDraft,
  type ProjectComposerSubmission,
} from './primitives/create-project';
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

/**
 * The composer is gone before the server answers, so the outcome touches
 * none of its panel state. Like task creation, success offers to open the
 * project through the layout's guarded open rather than navigating away
 * from wherever the user has gone since.
 */
async function settleProjectSubmission(
  { draft, result }: ProjectComposerSubmission,
  layout: Pick<
    ReturnType<typeof useSplitLayout>,
    'openWithSplit' | 'popoverSplit'
  >
) {
  let project: ProjectDetail;
  try {
    project = await result;
  } catch (error) {
    layout.popoverSplit({
      type: 'component',
      id: 'project-compose',
      params: { initialDraft: failedProjectDraft(draft, error) },
    });
    return;
  }
  const open = (preferNewSplit: boolean) =>
    layout.openWithSplit(
      {
        type: 'component',
        id: projectRouteId({ id: project.id, section: 'overview' }),
      },
      { referredFrom: null, preferNewSplit }
    );
  toast.success('Project created', {
    actions: [
      { label: 'Open', icon: ArrowSquareOutIcon, onClick: () => open(false) },
      {
        label: 'Open (New Split)',
        icon: SplitIcon,
        onClick: () => open(true),
      },
    ],
  });
}

export function CreateProjectView(props: {
  initialDraft?: ProjectComposerDraft;
}) {
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.setDisplayName('New project'));
  // A full composer returns its split to Projects; a submitted one also
  // leaves history, so Back does not reopen an empty composer.
  const close = (mergeHistory?: boolean) => {
    if (panel.handle.isPopover()) {
      panel.handle.close();
      return;
    }
    layout.replaceSplit({
      content: { type: 'component', id: 'tasks-projects' },
      mergeHistory,
    });
  };
  return (
    <Projects>
      <SplitPanel.Root class="bg-transparent">
        <SplitPanel.Body>
          <CreateProject
            initialDraft={props.initialDraft}
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
            onClose={() => close()}
            onSubmit={(submission) => {
              close(true);
              void settleProjectSubmission(submission, layout);
            }}
          />
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Projects>
  );
}
