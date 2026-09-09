/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` with derived props. All
 * block-level state stays on this side of the boundary.
 */

import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { onCleanup, onMount, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  AGENT_INPUT_TEXT_AREA_ID,
  AgentInput,
  AgentModelSelector,
  ComposerNotice,
  type QueuedPromptItem,
  QueuedPrompts,
} from '../ui';

export function AgentComposer(props: {
  /**
   * Whether the composer opens focused. The block adapter decides, from the
   * split layout and j/k navigation — same contract as Chat and Channel.
   */
  autofocus?: boolean;
}) {
  const {
    blockedOnUser,
    composer,
    elicitation,
    loadFailed,
    metadata,
    pending,
    queue,
    resuming,
    registerQuoteInsert,
  } = useAgentSession();
  const userId = useUserId();

  // Focus plumbing between the input and the queue list above it: Up at the
  // start of the input lands on the bottom (next-to-dispatch) queue row, and
  // Down past that row comes back. Plain variables, read only at call time.
  let focusQueueBottom: (() => void) | undefined;
  let focusInput: (() => void) | undefined;
  let regionRef: HTMLDivElement | undefined;

  // The server queue's entries, shaped for display: prompt text as-is, and
  // attribution only when somebody other than the current user queued it —
  // one's own waiting prompts need no byline.
  const queuedItems = (): QueuedPromptItem[] =>
    queue.entries().map((entry) => {
      const actor = entry.actorUserId ?? undefined;
      return {
        actionId: entry.actionId,
        kind: entry.kind,
        prompt: entry.prompt ?? undefined,
        queuedBy:
          actor && actor !== userId() ? idToDisplayName(actor) : undefined,
      };
    });

  // Stop the running turn so the oldest queued prompt dispatches now. Same
  // path as the composer's "Send next queued message" button.
  const canAdvanceQueue = () =>
    queuedItems().length > 0 && composer.busy() && !loadFailed() && !pending();

  const advanceQueue = () => {
    if (!canAdvanceQueue()) return;
    composer.stop();
  };

  // Backup for the empty composer: Lexical can swallow Enter before
  // `onEnter` runs. Queue rows handle Enter themselves so they can flush.
  onMount(() => {
    const region = regionRef;
    if (!region) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
        return;
      }
      if (!canAdvanceQueue()) return;
      const target = event.target as Node | null;
      const composerBox = document.getElementById(AGENT_INPUT_TEXT_AREA_ID);
      // Queue rows handle Enter themselves so they can flush in-progress
      // edits before the stop. This backup is only for the empty composer.
      if (!target || !composerBox?.contains(target)) return;
      if ((composerBox.innerText ?? '').trim().length > 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      advanceQueue();
    };
    region.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => region.removeEventListener('keydown', onKeyDown, true));
  });

  return (
    <div ref={regionRef}>
      <Show when={queuedItems().length > 0}>
        <div class="pb-1.5">
          <QueuedPrompts
            items={queuedItems()}
            onEdit={(actionId, prompt) => void queue.edit(actionId, prompt)}
            onRemove={(actionId) => void queue.remove(actionId)}
            onSendNext={advanceQueue}
            onNavigateBelow={() => focusInput?.()}
            registerFocusFromBelow={(focus) => {
              focusQueueBottom = focus;
            }}
          />
        </div>
      </Show>
      <Show when={resuming()}>
        <ComposerNotice text="Waking the agent's sandbox…" active />
      </Show>
      <Show when={blockedOnUser()}>
        <ComposerNotice
          text={
            elicitation.canAnswer()
              ? 'The agent is waiting for your answer above. Messages sent now are queued.'
              : `The agent is waiting for ${elicitation.ownerName()} to answer above. Messages sent now are queued.`
          }
        />
      </Show>
      <AgentInput
        placeholder="Message the agent, @mention anything"
        autofocus={props.autofocus}
        busy={composer.busy()}
        hasQueuedMessages={queuedItems().length > 0}
        // Prompts go straight to the service, so sending needs a session to
        // post to — a block whose create is still on the wire can be typed
        // into, but not sent from, until the id lands.
        disabled={loadFailed() || pending()}
        commands={() => metadata()?.availableCommands ?? []}
        onSend={composer.send}
        onStop={composer.stop}
        // Installed only while a queue row exists to land on: an installed
        // handler claims the keys (Up, and the shared plugin's other
        // leave-at-start keys), which must keep their defaults when there is
        // nowhere to go.
        onNavigateUp={
          queuedItems().length > 0 ? () => focusQueueBottom?.() : undefined
        }
        registerFocus={(focus) => {
          focusInput = focus;
        }}
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
    </div>
  );
}
