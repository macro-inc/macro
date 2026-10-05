import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import { describeToolCall, possessive } from '../state/tool-approval-wording';
import { ToolApprovalCard } from '../ui/ToolApprovalCard';

/** A held tool call above the composer, said as what the agent wants to do. */
export function ToolApprovalRequest(props: { request: HeldToolApproval }) {
  const session = useOptionalAgentSession();
  const name = (userId: string | null | undefined) =>
    userId ? (session?.displayName(userId) ?? userId) : undefined;
  const approvals = () => session?.toolApprovals;
  const owner = () => name(session?.session()?.ownerId) ?? 'the session owner';
  const action = () =>
    describeToolCall(
      { slug: props.request.serverSlug, name: props.request.serverName },
      props.request.toolName,
      approvals()?.canApprove() ? 'your' : possessive(owner())
    );
  const answer = (value: 'approve' | 'deny' | 'cancel') =>
    void approvals()?.answer(props.request.approvalId, value);
  return (
    <ToolApprovalCard
      action={action()}
      requester={name(props.request.requestedBy)}
      owner={owner()}
      canApprove={approvals()?.canApprove() === true}
      canCancel={approvals()?.canCancel() === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      onApprove={() => answer('approve')}
      onDeny={() => answer('deny')}
      onCancel={() => answer('cancel')}
    />
  );
}
