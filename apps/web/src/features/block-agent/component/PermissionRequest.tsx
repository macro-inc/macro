import { InteractionCard } from '@app/features/agent-interactions/components/InteractionCard';
import type { PendingPermission } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { ToolUsePart } from './parts/shared';

/**
 * Live approval above the composer, as the approval card the same request
 * is in a channel: what the agent wants to do, worded as its step reads,
 * with the tool's raw input folded away.
 */
export function PermissionRequest(props: { request: PendingPermission }) {
  const session = useOptionalAgentSession();
  const reply = () =>
    session
      ?.messages()
      .find(
        (message) =>
          message.author.kind === 'agent' && message.turn === props.request.turn
      );
  const tool = () =>
    reply()?.parts.find(
      (part): part is ToolUsePart =>
        part.kind === 'tool_use' && part.id === props.request.toolCall
    );
  // The run's own wording for the step the request is about.
  const step = () =>
    reply()
      ?.segments.flatMap((segment) => segment.rows)
      .find((row) => row.id === props.request.toolCall);
  return (
    <Show when={session}>
      {(live) => (
        <InteractionCard
          request={{ ...props.request, kind: 'permission' }}
          controller={live().interactions}
          tool={tool()}
          step={step()}
        />
      )}
    </Show>
  );
}
