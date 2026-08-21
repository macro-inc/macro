/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` and `QueuedPromptList`
 * with derived props. All block-level state stays on this side of the
 * boundary.
 */

import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAgentSession } from '../context/AgentSessionContext';
import { AgentInput, QueuedPromptList } from '../ui';

export function AgentComposer() {
  const { composer, loadFailed } = useAgentSession();
  const canAutofocus = useCanAutofocusSplitContent();

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
        autofocus={!isTouchDevice() && canAutofocus}
        onSend={composer.send}
        onStop={composer.stop}
        onReady={composer.attachInput}
      />
    </>
  );
}
