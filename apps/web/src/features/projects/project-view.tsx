import {
  projectDetailRoute,
  tasksProjectsRoute,
} from '@app/features/tasks-view/route';
import { useNavigate, useSplitHistory } from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { toast } from '@core/component/Toast/Toast';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import SplitIcon from '@phosphor/square-half.svg';
import { createEffect, onMount } from 'solid-js';
import type { ProjectRoute } from './core/route';
import { openProject } from './open-project';
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
 * The composer is gone before the server answers, so the outcome uses only
 * the app's split manager, never the closed composer's panel. Like task
 * creation, success offers to open the project rather than navigating away
 * from wherever the user has gone since.
 */
async function settleProjectSubmission({
  draft,
  result,
}: ProjectComposerSubmission) {
  const outcome = await result;
  const manager = globalSplitManager();
  if (!manager) return;
  if (outcome.status !== 'created') {
    manager.createPopoverSplit({
      content: {
        type: 'component',
        id: 'project-compose',
        params: { initialDraft: failedProjectDraft(draft, outcome) },
      },
    });
    return;
  }
  toast.success('Project created', {
    actions: [
      {
        label: 'Open',
        icon: ArrowSquareOutIcon,
        onClick: () => openProject(manager, outcome.id),
      },
      {
        label: 'Open (New Split)',
        icon: SplitIcon,
        onClick: () => openProject(manager, outcome.id, { newSplit: true }),
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
              void settleProjectSubmission(submission);
            }}
          />
        </SplitPanel.Body>
      </SplitPanel.Root>
    </Projects>
  );
}
