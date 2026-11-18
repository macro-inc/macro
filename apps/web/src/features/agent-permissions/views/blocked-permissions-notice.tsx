import type { GatedOperation } from '@service-agent-harness/generated/schemas';
import { BlockedByPermissionsCard } from '../components/blocked-by-permissions-card';
import { gatedFocus } from '../core/gated-operations';
import { useSessionToolPermissionsQuery } from '../queries/permissions';
import { useOpenAgentPermissions } from './open-agent-permissions';

/**
 * The blocked card in an agent session, linked to the agent's permissions
 * page when the viewer may change them. Until the session's permissions
 * load it shows without the link.
 */
export function BlockedPermissionsNotice(props: {
  sessionId: string;
  agentName: string;
  operations: readonly GatedOperation[];
}) {
  const viewQuery = useSessionToolPermissionsQuery(() => props.sessionId);
  const openPermissions = useOpenAgentPermissions();
  const view = () => (viewQuery.isSuccess ? viewQuery.data : undefined);
  // Unknown is not read-only: while loading, say nothing about who may edit.
  const canEdit = () => view()?.canEdit ?? viewQuery.isPending;

  return (
    <BlockedByPermissionsCard
      agentName={props.agentName}
      operations={props.operations}
      canEdit={canEdit()}
      onReview={
        view()?.canEdit
          ? () => {
              const agentId = view()?.agentId;
              if (agentId)
                openPermissions(agentId, gatedFocus(props.operations));
            }
          : undefined
      }
    />
  );
}
