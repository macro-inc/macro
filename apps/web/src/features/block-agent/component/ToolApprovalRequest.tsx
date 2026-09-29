import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import { ToolApprovalCard } from '../ui/ToolApprovalCard';

/** A held tool call above the composer, with the arguments it was called with. */
export function ToolApprovalRequest(props: { request: HeldToolApproval }) {
  const session = useOptionalAgentSession();
  const detail = () => {
    const part = session
      ?.messages()
      .flatMap((message) => message.parts)
      .find(
        (part) =>
          part.kind === 'tool_approval' &&
          part.approvalId === props.request.approvalId
      );
    if (part?.kind !== 'tool_approval') return undefined;
    return part.arguments === null || part.arguments === undefined
      ? undefined
      : JSON.stringify(part.arguments, null, 2);
  };
  const name = (userId: string | null | undefined) =>
    userId ? (session?.displayName(userId) ?? userId) : undefined;
  const approvals = () => session?.toolApprovals;
  const answer = (value: 'approve' | 'deny' | 'cancel') =>
    void approvals()?.answer(props.request.approvalId, value);
  return (
    <ToolApprovalCard
      server={props.request.serverName}
      tool={props.request.toolName}
      detail={detail()}
      requester={name(props.request.requestedBy)}
      owner={name(session?.session()?.ownerId) ?? 'the session owner'}
      canApprove={approvals()?.canApprove() === true}
      canCancel={approvals()?.canCancel() === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      onApprove={() => answer('approve')}
      onDeny={() => answer('deny')}
      onCancel={() => answer('cancel')}
    />
  );
}
