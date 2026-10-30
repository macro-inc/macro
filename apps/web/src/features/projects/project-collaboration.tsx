import { EntityConversation } from '@core/messages/EntityConversation';
import { buildSimpleEntityUrl } from '@core/util/url';
import { createMemo, createSignal } from 'solid-js';
import { projectRouteId } from './core/route';

/** Projects use the same unanchored discussion and composer as task detail. */
export function ProjectDiscussion(props: {
  projectId: string;
  canWrite: boolean;
  targetId?: string;
}) {
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
