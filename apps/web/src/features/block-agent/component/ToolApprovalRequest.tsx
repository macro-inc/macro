import type { ToolApprovalAnswerDto } from '@service-agent-harness/generated/schemas';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import {
  describeStandingApproval,
  describeToolCall,
  possessive,
} from '../state/tool-approval-wording';
import { ToolApprovalCard } from '../ui/ToolApprovalCard';

/** A held tool call above the composer, said as what the agent wants to do. */
export function ToolApprovalRequest(props: { request: HeldToolApproval }) {
  const session = useOptionalAgentSession();
  const name = (userId: string | null | undefined) =>
    userId ? (session?.displayName(userId) ?? userId) : undefined;
  const approvals = () => session?.toolApprovals;
  const owner = () => name(session?.session()?.ownerId) ?? 'the session owner';
  const server = () => ({
    slug: props.request.serverSlug,
    name: props.request.serverName,
  });
  const whose = () =>
    approvals()?.canApprove() ? 'your' : possessive(owner());
  const action = () =>
    describeToolCall(server(), props.request.toolName, whose());
  // Only a person can be remembered, not a bot acting on nobody's behalf.
  const standing = () =>
    props.request.requestedBy
      ? describeStandingApproval(server(), props.request.toolName, whose())
      : undefined;
  const answer = (value: ToolApprovalAnswerDto) =>
    void approvals()?.answer(props.request.approvalId, value);
  return (
    <ToolApprovalCard
      action={action()}
      standing={standing()}
      requester={name(props.request.requestedBy)}
      owner={owner()}
      canApprove={approvals()?.canApprove() === true}
      canCancel={approvals()?.canCancel() === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      onApprove={() => answer('approve')}
      onApproveAlways={() => answer('approve_and_remember')}
      onDeny={() => answer('deny')}
      onCancel={() => answer('cancel')}
    />
  );
}
