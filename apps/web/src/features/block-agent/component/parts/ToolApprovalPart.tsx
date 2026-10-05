/**
 * A tool call held for the session owner, once answered. Pending ones live
 * above the composer so there is only one place to answer them.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { useOptionalAgentSession } from '../../context/AgentSessionContext';
import {
  describeToolCall,
  possessive,
} from '../../state/tool-approval-wording';
import { ToolCard } from '../../ui';

export function ToolApprovalPart(props: {
  part: Extract<MessagePart, { kind: 'tool_approval' }>;
}) {
  const session = useOptionalAgentSession();
  const by = () => {
    const resolvedBy = props.part.resolvedBy;
    return resolvedBy
      ? (session?.displayName(resolvedBy) ?? resolvedBy)
      : undefined;
  };
  const owner = () => {
    const ownerId = session?.session()?.ownerId;
    if (!ownerId) return "the owner's";
    return ownerId === session?.userId()
      ? 'your'
      : possessive(session?.displayName(ownerId) ?? ownerId);
  };
  // "Read your email", from "read your email".
  const title = () => {
    const action = describeToolCall(
      { slug: props.part.serverSlug, name: props.part.serverName },
      props.part.toolName,
      owner()
    );
    return action.charAt(0).toUpperCase() + action.slice(1);
  };
  const outcome = () =>
    match(props.part.status)
      .with('pending', () => 'Waiting for approval')
      .with('approved', () => {
        const approved = props.part.remembered ? 'Always allowed' : 'Approved';
        return by() ? `${approved} by ${by()}` : approved;
      })
      .with('denied', () => (by() ? `Declined by ${by()}` : 'Declined'))
      .with('cancelled', () => (by() ? `Cancelled by ${by()}` : 'Cancelled'))
      .with('expired', () => 'Not approved in time')
      .exhaustive();

  return (
    <Show when={props.part.status !== 'pending'}>
      <ToolCard
        title={title()}
        trailing={<span class="text-ink">{outcome()}</span>}
        status="completed"
      />
    </Show>
  );
}
