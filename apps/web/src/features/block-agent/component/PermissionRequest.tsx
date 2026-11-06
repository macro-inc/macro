import { PermissionCard } from '@app/features/agent-interactions/components/PermissionCard';
import { createRuntimeBypass } from '@app/features/agent-interactions/primitives/create-runtime-bypass';
import { confirmPermissionBypass } from '@app/features/settings/confirm-permission-bypass';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { PendingPermission } from '@service-agent-fold/generated/types';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { toolCallDetail, toolLabel } from './parts/shared';

/** Live approval above the composer, with context from the requested tool. */
export function PermissionRequest(props: { request: PendingPermission }) {
  const session = useOptionalAgentSession();
  const identity = () => ({ ...props.request, kind: 'permission' as const });
  const canAnswer = () => session?.interactions.canAnswer() === true;
  const runtimeBypass = createRuntimeBypass({
    sessionId: () => session?.sessionId(),
    enabled: canAnswer,
    respond: (response) =>
      session?.interactions.respond(response) ?? Promise.resolve(false),
    confirm: confirmPermissionBypass,
    onFailure: (message) => toast.failure(message),
  });
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
      canAnswer={canAnswer()}
      disabled={session?.interactions.answering(identity())}
      stopAsking={runtimeBypass.action(props.request)}
      onSelect={(optionId) =>
        fireAndForget(
          session?.interactions.respond({
            ...identity(),
            answer: { kind: 'selected', optionId },
          }),
          'agent-interactions'
        )
      }
    />
  );
}
