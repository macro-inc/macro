import {
  AccessDenied,
  useShareRequests,
} from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { createMemo, createSignal, Match, Switch } from 'solid-js';
import { ProjectContentSkeleton } from './components/project-skeletons';
import type { ProjectSection } from './core/project';

/**
 * A project that did not load. Its access-request state loads only while the
 * project exists, so a viewer without access can request it and a deleted
 * project keeps the unavailable notice.
 */
export function ProjectUnavailable(props: {
  projectId: string;
  section: ProjectSection;
  onRetry(): Promise<void>;
}) {
  const requests = useShareRequests(
    () => shareEntity('initiative', props.projectId),
    () => true
  );
  const [reloadedId, setReloadedId] = createSignal<string>();
  // Stays denied after a grant, so the request view holds while the project
  // reloads; a reload that settles without the project falls back to Try again.
  const deniedId = createMemo<string | undefined>((denied) => {
    const state = requests.state();
    if (state && state.accessLevel == null) return props.projectId;
    return denied === props.projectId && reloadedId() !== props.projectId
      ? denied
      : undefined;
  });
  const reloadGranted = async () => {
    const projectId = props.projectId;
    try {
      await props.onRetry();
    } finally {
      setReloadedId(projectId);
    }
  };
  const retry = async () => {
    await Promise.all([props.onRetry(), requests.refresh()]);
  };
  return (
    <Switch
      fallback={
        <div role="alert" class="p-6">
          <p>
            Project unavailable. It may have been deleted, or you may no longer
            have access.
          </p>
          <Button
            variant="ghost"
            onClick={() => fireAndForget(retry(), 'projects')}
          >
            Try again
          </Button>
        </div>
      }
    >
      <Match when={deniedId()}>
        <AccessDenied
          source={requests}
          noun="project"
          onAccessGranted={() => fireAndForget(reloadGranted(), 'projects')}
        />
      </Match>
      <Match when={requests.loading()}>
        <ProjectContentSkeleton section={props.section} />
      </Match>
    </Switch>
  );
}
