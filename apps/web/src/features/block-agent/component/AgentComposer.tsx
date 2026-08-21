/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` and `QueuedPromptList`
 * with derived props. All block-level state stays on this side of the
 * boundary.
 */

import { useAgentSession } from '../context/AgentSessionContext';
import { AgentInput, QueuedPromptList } from '../ui';

export function AgentComposer() {
  const { composer, loadFailed } = useAgentSession();

  return (
    <>
      <QueuedPromptList
        prompts={composer.queue()}
        sendingId={composer.sendingId()}
        failed={composer.sendFailed()}
        onRetry={composer.retry}
        onRemove={composer.remove}
      />
      <AgentInput
        placeholder="Message the agent"
        busy={composer.busy()}
        disabled={loadFailed()}
        onSend={composer.send}
        onStop={composer.stop}
      />
    </>
  );
}
