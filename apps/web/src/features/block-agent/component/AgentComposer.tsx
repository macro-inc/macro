/**
 * The block's composer container: reads the session from context and drives
 * the dumb `AgentInput` with derived props. Every in-flight state it shows
 * comes from the fold. The composer also holds the model selector while a
 * combined model-and-effort change waits for runtime confirmation.
 */

import { useOptionalAgentChanges } from '@app/features/agent-changes/context/agent-changes-controller';
import {
  createInputAttachmentTracker,
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { toast } from '@core/component/Toast/Toast';
import { uploadFile } from '@core/util/upload';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { type Component, createSignal, For, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import {
  changingConfig,
  changingModel,
  hasPendingStop,
} from '../state/control-message';
import {
  type EffortSelection,
  effortConfigOption,
  effortLabel,
} from '../state/session-config';
import {
  AgentInput,
  type AgentInputProps,
  AgentModelSelector,
  ComposerNotice,
  type QueuedPromptItem,
  QueuedPrompts,
} from '../ui';
import type { AgentModelSelectorProps } from '../ui/AgentModelSelector';
import { AgentModelMenuItem } from './AgentModelMenuItem';
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
    session,
    selectModel,
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
  const changes = useOptionalAgentChanges();
  const readOnly = () => session()?.canEdit === false;

  // The fold speculates the action the moment it is issued, so success is
  // observed there; only a refusal needs saying here.
  const act = async (action: AgentAction, failure: string) => {
    if (readOnly()) return;
    try {
      const result = await issue(action);
      if (result?.isErr()) toast.failure(failure);
    } catch {
      toast.failure(failure);
    }
  };

  const [configuring, setConfiguring] = createSignal(false);
  const chooseModel = async (model: string, selection?: EffortSelection) => {
    if (readOnly() || configuring()) return;
    setConfiguring(true);
    try {
      await selectModel(model, selection);
    } catch (error) {
      toast.failure(
        error instanceof Error
          ? error.message
          : 'The model settings could not be changed'
      );
    } finally {
      setConfiguring(false);
    }
  };

  const effort = () => effortConfigOption(metadata()?.configOptions ?? []);
  const changingEffort = () => {
    const option = effort();
    return option ? changingConfig(messages(), option.id) : undefined;
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
  const attachFiles = (files: File[]) => {
    if (readOnly()) return;
    void uploadInputAttachments({
      files,
      tracker: attachmentTracker,
      uploadFile: (file) =>
        uploadFile(file, 'static', { hideProgressIndicator: true }),
    });
  };
  // Attachments ride the prompt action itself, so they take the same path as
  // the text: issued once, speculated by the fold, and queued server-side
  // behind a running turn with the files still on them.
  const send = (markdown: string, attachments: InputAttachmentData[]) => {
    if (readOnly()) return;
    // Queued review notes ride this send: taking them here marks them sent
    // before the prompt is issued, so a second Enter cannot post them again
    // as their own queued prompt (which would then stop-and-flush).
    const notes = changes?.consumeSendableNotes() ?? '';
    const prompt = [markdown, notes]
      .filter((part) => part.length > 0)
      .join('\n\n');
    void act(
      promptActionOf(prompt, attachments),
      'The message could not be sent'
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
        queuedBy: actor && actor !== userId() ? displayName(actor) : undefined,
      };
    });

  return (
    <>
      <Show when={queuedItems().length > 0}>
        <div class="pb-1.5">
          <QueuedPrompts
            items={queuedItems()}
            disabled={readOnly()}
            onEdit={(actionId, prompt) => {
              if (!readOnly()) void queue.edit(actionId, prompt);
            }}
            onRemove={(actionId) => {
              if (!readOnly()) void queue.remove(actionId);
            }}
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
        placeholder={
          readOnly()
            ? 'You have view-only access to this agent session'
            : 'Message the agent, @mention anything'
        }
        readOnly={readOnly()}
        autofocus={props.autofocus}
        busy={busy()}
        hasQueuedMessages={queuedItems().length > 0}
        // Read off the fold's turn discriminant, never `pending`, which
        // clears as soon as the log confirms a cancel - well before the
        // runtime winds the turn down, and every Enter in that gap posted
        // another cancel. `stopping` is a stop already working on this turn.
        // `starting` is the prompt the last advance showed as sent, still
        // unconfirmed: the server has not dispatched it, so a stop now would
        // end the turn already ending and the server would dispatch *that*
        // head - the next one would sit as a sent-looking bubble while it
        // waits. Enter is admitted again once the log confirms the head.
        sendNextHeld={turn() === 'stopping' || turn() === 'starting'}
        // Prompts go straight to the service, so sending needs a session to
        // post to — a block whose create is still on the wire can be typed
        // into, but not sent from, until the id lands.
        disabled={loadFailed() || pending() || readOnly()}
        commands={() => metadata()?.availableCommands ?? []}
        onSend={send}
        onStop={() =>
          void act({ type: 'stop' }, 'The agent could not be stopped')
        }
        onSendNext={() => {
          if (!readOnly()) sendNext();
        }}
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
            effortLabel={effortLabel(effort(), changingEffort())}
            disabled={
              loadFailed() ||
              readOnly() ||
              pending() ||
              configuring() ||
              changingEffort() !== undefined
            }
            onSelect={(model) => void chooseModel(model)}
            modelRow={(row) => (
              <AgentModelMenuItem
                {...row}
                harness={session()?.harness}
                effort={
                  row.option.id === metadata()?.model ? effort() : undefined
                }
                effortValue={
                  row.option.id === metadata()?.model
                    ? changingEffort()
                    : undefined
                }
                onSelectEffort={(selection) =>
                  void chooseModel(row.option.id, selection)
                }
              />
            )}
          />
        }
      />
    </>
  );
}
