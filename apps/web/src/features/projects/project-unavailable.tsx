import {
  AccessDenied,
  useShareRequests,
} from '@app/features/access-requests/access-requests';
import { shareEntity } from '@app/features/access-requests/core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button } from '@ui';
import { createMemo, Match, Switch } from 'solid-js';
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
  // Stays denied after a grant, so the request view holds until the project loads.
  const deniedId = createMemo<string | undefined>((denied) => {
    const state = requests.state();
    if (state && state.accessLevel == null) return props.projectId;
    return denied === props.projectId ? denied : undefined;
  });
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
            onClick={() => fireAndForget(props.onRetry(), 'projects')}
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
          onAccessGranted={() => fireAndForget(props.onRetry(), 'projects')}
        />
      </Match>
      <Match when={requests.loading()}>
        <ProjectContentSkeleton section={props.section} />
      </Match>
    </Switch>
  );
}
