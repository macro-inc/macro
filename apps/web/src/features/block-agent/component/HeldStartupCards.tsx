import { fireAndForget } from '@core/util/fireAndForget';
import { For } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { UnconfirmedSendCard } from '../ui/UnconfirmedSendCard';

/**
 * First prompts a lost create may have started, on a session host (the Home
 * block or the Agents pane) that has no session to show them in: the startup
 * error, or (after a reload, when the create never landed) the failed or
 * refused load.
 */
export function HeldStartupCards() {
  const { startupHeld, dropStartupHeld } = useAgentSession();
  return (
    <div class="mx-auto w-full max-w-2xl px-4">
      <For each={startupHeld?.() ?? []}>
        {(held) => (
          <UnconfirmedSendCard
            text={held.action.type === 'prompt' ? held.action.prompt : ''}
            attachmentCount={
              held.action.type === 'prompt'
                ? (held.action.attachments?.length ?? 0)
                : 0
            }
            onCopy={() =>
              fireAndForget(
                navigator.clipboard.writeText(
                  held.action.type === 'prompt' ? held.action.prompt : ''
                ),
                'agent-block'
              )
            }
            onDismiss={() => dropStartupHeld?.(held.actionId)}
          />
        )}
      </For>
    </div>
  );
}
