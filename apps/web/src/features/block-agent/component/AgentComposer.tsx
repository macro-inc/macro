/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` with derived props. All
 * block-level state stays on this side of the boundary.
 */

import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import type { MessagePart } from '@service-agent-fold/generated/types';
import { For, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  AgentInput,
  AgentModelSelector,
  ComposerNotice,
  PermissionOptions,
  type QueuedPromptItem,
  QueuedPrompts,
} from '../ui';

type PendingPermission = Extract<MessagePart, { kind: 'permission' }>;

export function AgentComposer() {
  const {
    composer,
    loadFailed,
    messages,
    metadata,
    pending,
    queue,
    resuming,
    working,
    registerQuoteInsert,
  } = useAgentSession();
  const userId = useUserId();

  // Permission requests the agent is blocked on, surfaced here so a prompt
  // buried mid-transcript is not missed. Only the running turn's: a request
  // left open by a turn that already ended can no longer be answered.
  const pendingPermissions = (): PendingPermission[] => {
    if (!working()) return [];
    const last = messages().at(-1);
    if (last?.author.kind !== 'agent' || last.stop != null) return [];
    return last.parts.filter(
      (part): part is PendingPermission =>
        part.kind === 'permission' && part.outcome.kind === 'pending'
    );
  };

  // Focus plumbing between the input and the queue list above it: Up at the
  // start of the input lands on the bottom (next-to-dispatch) queue row, and
  // Down past that row comes back. Plain variables, read only at call time.
  let focusQueueBottom: (() => void) | undefined;
  let focusInput: (() => void) | undefined;

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

  // A session still being created was created by this user, one action ago,
  // and has an empty transcript: the only thing to do with it is type. The
  // wait for the sandbox is exactly when that matters most.
  const autofocus = pending();

  return (
    <>
      <Show when={queuedItems().length > 0}>
        <div class="pb-1.5">
          <QueuedPrompts
            items={queuedItems()}
            onEdit={(actionId, prompt) => void queue.edit(actionId, prompt)}
            onRemove={(actionId) => void queue.remove(actionId)}
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
      <For each={pendingPermissions()}>
        {(permission) => (
          <div class="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-edge-muted bg-surface px-3 py-2 text-xs">
            <span class="text-ink">
              The agent is waiting for your permission to continue.
            </span>
            <PermissionOptions
              options={permission.options}
              disabled={composer.answeringPermission(permission.requestId)}
              onSelect={(optionId) =>
                composer.respondToPermission(permission.requestId, {
                  kind: 'selected',
                  optionId,
                })
              }
            />
          </div>
        )}
      </For>
      <AgentInput
        placeholder="Message the agent, @mention anything"
        autofocus={autofocus}
        busy={composer.busy()}
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
    </>
  );
}
