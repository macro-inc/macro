import { DocumentConversation } from '@core/messages/DocumentConversation';
import { buildSimpleEntityUrl } from '@core/util/url';
import { projectRouteId } from './core/route';

/** Projects use the same unanchored discussion and composer as task detail. */
export function ProjectDiscussion(props: {
  projectId: string;
  canWrite: boolean;
  targetId?: string;
}) {
  return (
    <DocumentConversation
      parent={{ type: 'initiative', id: props.projectId }}
      canWrite={props.canWrite}
      targetId={props.targetId}
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
