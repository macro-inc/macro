/**
 * The block's composer container: reads the composer controller from the
 * session context and drives the dumb `AgentInput` with derived props. All
 * block-level state stays on this side of the boundary.
 */

import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { uploadFile } from '@core/util/upload';
import type { PromptAttachment } from '@service-agent-harness/generated/schemas';
import { Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  AgentInput,
  AgentModelSelector,
  ComposerNotice,
  type QueuedPromptItem,
  QueuedPrompts,
} from '../ui';

/**
 * The prompt attachment for an uploaded file: the static file service URL
 * the agent fetches it from, plus what the chip knew about it.
 */
function promptAttachmentOf(attachment: InputAttachmentData): PromptAttachment {
  return {
    uri: staticFileIdEndpoint(attachment.id),
    name: attachment.name,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  };
}

export function AgentComposer(props: {
  /**
   * Whether the composer opens focused. The block adapter decides, from the
   * split layout and j/k navigation — same contract as Chat and Channel.
   */
  autofocus?: boolean;
}) {
  const {
    composer,
    loadFailed,
    metadata,
    pending,
    queue,
    resuming,
    registerQuoteInsert,
  } = useAgentSession();
  const userId = useUserId();

  // Files dropped, pasted, or picked into the composer. Every one goes to
  // the static file service - documents too, not only media - because the
  // agent can only reach a file by a URL it can fetch. The chips and the
  // upload flow are the channel composer's.
  const attachmentTracker = createInputAttachmentTracker();
  const attachFiles = (files: File[]) =>
    void uploadInputAttachments({
      files,
      tracker: attachmentTracker,
      uploadFile: (file) =>
        uploadFile(file, 'static', { hideProgressIndicator: true }),
    });
  const send = (markdown: string, attachments: InputAttachmentData[]) => {
    composer.send(
      markdown,
      attachments
        .filter((attachment) => !attachment.pending)
        .map(promptAttachmentOf)
    );
    attachmentTracker.clearAttachments();
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
        attachments: entry.attachments,
        queuedBy:
          actor && actor !== userId() ? idToDisplayName(actor) : undefined,
      };
    });

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
        onSend={send}
        onStop={composer.stop}
        attachments={attachmentTracker.attachments()}
        onAttachFiles={attachFiles}
        onRemoveAttachment={(attachment) =>
          attachmentTracker.removeAttachment(attachment.id)
        }
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
