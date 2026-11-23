import {
  describeGatedThings,
  gatedFocus,
  permissionRequestParts,
  useAgentPermissionsFlag,
  useOpenAgentPermissions,
  useSessionToolPermissionsQuery,
} from '@app/features/agent-permissions';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ToolApprovalAnswerDto } from '@service-agent-harness/generated/schemas';
import { createMemo } from 'solid-js';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import { parsePermissionHold } from '../state/permission-approval';
import { PermissionRequestCard } from '../ui/PermissionRequestCard';

/**
 * A program held because operations it may call are set to Ask, docked
 * above the composer: the person it acts for allows it once, for the
 * session, or denies it. Everyone else waits, and may cancel. Answered, the
 * card goes; the program's own row in the transcript says what happened.
 */
export function PermissionApprovalRequest(props: {
  request: HeldToolApproval;
}) {
  const session = useOptionalAgentSession();
  const approvals = () => session?.toolApprovals;
  // The hold stays answerable whatever the flag says (a run waits on it), but
  // the link to the agent's permissions reads them only with the flag on.
  const permissionsFlag = useAgentPermissionsFlag();
  const permissionsQuery = useSessionToolPermissionsQuery(
    () => session?.sessionId() ?? '',
    () => permissionsFlag() && Boolean(session?.sessionId())
  );
  const openPermissions = useOpenAgentPermissions();

  // The pending request carries no arguments; its transcript part does.
  const hold = createMemo(() => {
    for (const message of session?.messages() ?? []) {
      for (const part of message.parts) {
        if (
          part.kind === 'tool_approval' &&
          part.approvalId === props.request.approvalId
        ) {
          return parsePermissionHold(part.arguments);
        }
      }
    }
    return undefined;
  });
  const operations = () => hold()?.operations ?? [];

  const agent = () =>
    session?.bot()?.name ?? t('agentPermissionsChat.theAgent');
  const approverId = () =>
    props.request.approver ?? session?.session()?.ownerId ?? undefined;
  const approverName = () => {
    const id = approverId();
    return id
      ? (session?.displayName(id) ?? id)
      : t('agentPermissionsChat.theApprover');
  };
  const view = () =>
    permissionsQuery.isSuccess
      ? (permissionsQuery.data ?? undefined)
      : undefined;

  const waitingDescription = () =>
    operations().length > 0
      ? t('agentPermissionsChat.wantsToWithAccess', {
          agent: agent(),
          things: describeGatedThings(operations()),
          name: approverName(),
        })
      : t('agentPermissionsChat.wantsToRunWithAccess', {
          agent: agent(),
          name: approverName(),
        });

  const answer = (value: ToolApprovalAnswerDto) =>
    fireAndForget(
      approvals()?.answer(props.request.approvalId, value),
      'agent-interactions'
    );
  const openSettings = () => {
    const agentId = view()?.agentId;
    if (agentId) openPermissions(agentId, gatedFocus(operations()));
  };

  return (
    <PermissionRequestCard
      canApprove={approvals()?.canApprove(props.request) === true}
      request={permissionRequestParts(agent(), operations())}
      approver={approverName()}
      waitingDescription={waitingDescription()}
      canCancel={approvals()?.canCancel() === true}
      canEditPermissions={view()?.canEdit === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      onApproveOnce={() => answer('approve')}
      onAllowInSession={() => answer('approve_and_remember')}
      onDeny={() => answer('deny')}
      onEditPermissions={openSettings}
      onCancel={() => answer('cancel')}
    />
  );
}
