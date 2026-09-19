/**
 * The block's composer container: reads the session from context and drives
 * the dumb `AgentInput` with derived props. Every in-flight state it shows
 * is read off the fold — the turn discriminant and the messages' pending
 * marks — so the composer keeps no state of its own.
 */

import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { toast } from '@core/component/Toast/Toast';
import { uploadFile } from '@core/util/upload';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { type Component, For, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { changingModel, hasPendingStop } from '../state/control-message';
import {
  AgentInput,
  type AgentInputProps,
  AgentModelSelector,
  ComposerNotice,
  type QueuedPromptItem,
  QueuedPrompts,
} from '../ui';
import type { AgentModelSelectorProps } from '../ui/AgentModelSelector';
import { PermissionRequest } from './PermissionRequest';
import { promptActionOf } from './prompt-action';

export function AgentComposer(props: {
  /**
   * Whether the composer opens focused. The block adapter decides, from the
   * split layout and j/k navigation — same contract as Chat and Channel.
   */
  autofocus?: boolean;
  input?: Component<AgentInputProps>;
  modelSelector?: Component<AgentModelSelectorProps>;
}) {
  const Input = props.input ?? AgentInput;
  const ModelSelector = props.modelSelector ?? AgentModelSelector;
  const {
    displayName,
    userId,
    interactions,
    issue,
    loadFailed,
    messages,
    metadata,
    pending,
    queue,
    sendNext,
    turn,
    registerQuoteInsert,
  } = useAgentSession();

  // The fold speculates the action the moment it is issued, so success is
  // observed there; only a refusal needs saying here.
  const act = (action: AgentAction, failure: string) => {
    void issue(action)?.then((result) => {
      if (result.isErr()) toast.failure(failure);
    });
  };

  // A turn is open in some form: the send button becomes a stop square and
  // prompts sent now wait in the server queue behind it. A stop the fold has
  // speculated already reads as done - the button goes back to send with the
  // rest of the transcript, and the log confirms the end of the turn later.
  const busy = () => {
    const state = turn();
    return (
      (state !== 'idle' && state !== 'disconnected' && state !== 'stopping') ||
      resuming()
    );
  };
  // The runtime is gone and the user has asked it for something anyway, so
  // the service is bringing its sandbox back before it can deliver. There is
  // no signal for this on the wire; it is the one honest inference from a
  // disconnected runtime and a pending action of ours. The wake is a turn in
  // all but name, so it can be stopped - and a pending stop ends it here as
  // it does everywhere else, before the log says so.
  const resuming = () =>
    turn() === 'disconnected' &&
    messages().some((message) => message.pending) &&
    !hasPendingStop(messages());

  const pendingPermissions = () =>
    interactions.pending().filter((request) => request.kind === 'permission');
  const pendingElicitation = () =>
    interactions.pending().some((request) => request.kind === 'elicitation');
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
  // Attachments ride the prompt action itself, so they take the same path as
  // the text: issued once, speculated by the fold, and queued server-side
  // behind a running turn with the files still on them.
  const send = (markdown: string, attachments: InputAttachmentData[]) => {
    act(promptActionOf(markdown, attachments), 'The message could not be sent');
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
        queuedBy: actor && actor !== userId() ? displayName(actor) : undefined,
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
      <Show when={pendingElicitation()}>
        <ComposerNotice
          text={
            interactions.canAnswer()
              ? 'The agent is waiting for your answer above. Messages sent now are queued.'
              : 'The agent is waiting for an editor to answer above. Messages sent now are queued.'
          }
        />
      </Show>
      <For each={pendingPermissions()}>
        {(permission) => (
          <div class="mb-2 min-w-0">
            <PermissionRequest request={permission} />
          </div>
        )}
      </For>
      <Input
        placeholder="Message the agent, @mention anything"
        autofocus={props.autofocus}
        busy={busy()}
        hasQueuedMessages={queuedItems().length > 0}
        // The fold's own answer to "a stop is already working on this turn",
        // which holds from the moment the stop is folded until the turn
        // actually ends. `pending` alone clears as soon as the log confirms
        // the cancel, which is well before the runtime winds the turn down -
        // and every Enter in that gap posted another cancel.
        stopPending={turn() === 'stopping'}
        // Prompts go straight to the service, so sending needs a session to
        // post to — a block whose create is still on the wire can be typed
        // into, but not sent from, until the id lands.
        disabled={loadFailed() || pending()}
        commands={() => metadata()?.availableCommands ?? []}
        onSend={send}
        onStop={() => act({ type: 'stop' }, 'The agent could not be stopped')}
        onSendNext={sendNext}
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
          <ModelSelector
            model={metadata()?.model ?? null}
            changingTo={changingModel(messages(), metadata()?.model ?? null)}
            options={metadata()?.supportedModels ?? []}
            disabled={loadFailed()}
            onSelect={(model) =>
              act({ type: 'setModel', model }, 'The model could not be changed')
            }
          />
        }
      />
    </>
  );
}
