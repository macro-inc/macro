/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` and `QueuedPromptList`
 * with derived props. All block-level state stays on this side of the
 * boundary.
 */

import { Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  AgentInput,
  AgentModelSelector,
  ComposerNotice,
  QueuedPromptList,
} from '../ui';

export function AgentComposer() {
  const {
    composer,
    loadFailed,
    metadata,
    pending,
    resuming,
    registerQuoteInsert,
  } = useAgentSession();

  // A session still being created was created by this user, one action ago,
  // and has an empty transcript: the only thing to do with it is type. The
  // wait for the sandbox is exactly when that matters most.
  const autofocus = pending();

  return (
    <>
      <Show when={resuming()}>
        <ComposerNotice text="Waking the agent's sandbox…" active />
      </Show>
      <QueuedPromptList
        prompts={composer.queue()}
        sendingId={composer.sendingId()}
        failed={composer.sendFailed()}
        onRetry={composer.retry}
        onRemove={composer.remove}
      />
      <AgentInput
        placeholder="Message the agent"
        autofocus={autofocus}
        busy={composer.busy()}
        disabled={loadFailed()}
        commands={() => metadata()?.availableCommands ?? []}
        onSend={composer.send}
        onStop={composer.stop}
        registerQuoteInsert={registerQuoteInsert}
        modelControl={
          <AgentModelSelector
            model={metadata()?.model ?? null}
            changingTo={composer.changingModel()}
            options={metadata()?.supportedModels ?? []}
            disabled={loadFailed()}
            onSelect={composer.setModel}
          />
        }
      />
    </>
  );
}
