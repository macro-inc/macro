import type { PendingPermission } from '@service-agent-fold/generated/types';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { PermissionCard } from '../ui/PermissionCard';
import { toolCallDetail, toolLabel } from './parts/shared';

/** Live approval above the composer, with context from the requested tool. */
export function PermissionRequest(props: { request: PendingPermission }) {
  const session = useOptionalAgentSession();
  const identity = () => ({ ...props.request, kind: 'permission' as const });
  const tool = () =>
    session
      ?.messages()
      .find(
        (message) =>
          message.author.kind === 'agent' && message.turn === props.request.turn
      )
      ?.parts.find(
        (part) => part.kind === 'tool_use' && part.id === props.request.toolCall
      );
  const detail = () => {
    const part = tool();
    return part?.kind === 'tool_use' ? toolCallDetail(part) : undefined;
  };
  const action = () => {
    const part = tool();
    if (part?.kind !== 'tool_use') return undefined;
    return part.detail.kind === 'terminal'
      ? 'Run command'
      : toolLabel(part.name);
  };
  return (
    <PermissionCard
      action={action()}
      detail={detail()}
      options={props.request.options}
      canAnswer={session?.interactions.canAnswer() === true}
      disabled={session?.interactions.answering(identity())}
      onSelect={(optionId) =>
        void session?.interactions.respond({
          ...identity(),
          answer: { kind: 'selected', optionId },
        })
      }
    />
  );
}
