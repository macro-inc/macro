import { useIsAuthenticated } from '@core/auth';
import { EntityConversation } from '@core/messages/EntityConversation';
import { buildSimpleEntityUrl } from '@core/util/url';
import { createMemo, createSignal, Match, Switch } from 'solid-js';
import { projectRouteId } from './core/route';

type ProjectDiscussionProps = {
  projectId: string;
  canWrite: boolean;
  targetId?: string;
};

/**
 * Projects use the same unanchored discussion and composer as task detail. A
 * caller with no account is offered sign-in, as on a public document.
 */
export function ProjectDiscussion(props: ProjectDiscussionProps) {
  const authenticated = useIsAuthenticated();
  return (
    <Switch>
      <Match when={authenticated() === true}>
        <AuthenticatedProjectDiscussion {...props} />
      </Match>
      <Match when={authenticated() === false}>
        <p class="mt-3 text-xs text-ink-muted">Sign in to view comments.</p>
      </Match>
    </Switch>
  );
}

function AuthenticatedProjectDiscussion(props: ProjectDiscussionProps) {
  const targetId = createMemo(() => props.targetId);
  const targetRequest = createMemo(() => ({ id: targetId() }));
  const [clearedTarget, setClearedTarget] =
    createSignal<ReturnType<typeof targetRequest>>();

  return (
    <EntityConversation
      parent={{ type: 'initiative', id: props.projectId }}
      canWrite={props.canWrite}
      targetId={props.targetId}
      targetCleared={clearedTarget() === targetRequest()}
      onClearTarget={() => setClearedTarget(targetRequest())}
      buildLink={(message) =>
        buildSimpleEntityUrl({
          type: 'component',
          id: projectRouteId({
            id: props.projectId,
            section: 'overview',
            discussionId: message.id,
          }),
        })
      }
    />
  );
}
