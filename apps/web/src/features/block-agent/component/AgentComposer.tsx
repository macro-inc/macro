import { UnifiedModelSelector } from '@app/features/agents-view/model-selector';
import {
  catalogModelLabel,
  modelLabel,
} from '@core/component/AI/constant/model-label';
import { nativeSpeeds, resolveSpeed } from '@core/component/AI/constant/speed';
import {
  preferredSpeed,
  setPreferredSpeed,
} from '@core/component/AI/signal/speed';
/**
 * The block's composer container: reads the session from context and drives
 * the dumb `AgentInput` with derived props. Every in-flight state it shows
 * comes from the fold. The composer also holds the model selector while a
 * combined model-and-effort change waits for runtime confirmation.
 */

import { isMacroHarness } from '@app/features/agents-view/core/agent-kind';
import { useOptionalChanges } from '@app/features/changes/context/changes-controller';
import {
  type InputAttachmentData,
  uploadInputAttachments,
} from '@channel/Input';
import { SEND_OUTCOME_UNKNOWN } from '@core/agent-session/send-outcome';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { uploadFile } from '@core/util/upload';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { isNoRuntimeAccessError } from '@service-agent-harness/no-runtime-access';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import type { UnconfirmedSend } from '../context/create-agent-session';
import {
  createSessionAttachmentTracker,
  createSessionComposerDraft,
} from '../primitives/session-composer-draft';
import {
  changingConfig,
  changingModel,
  hasPendingStop,
} from '../state/control-message';
import {
  type EffortSelection,
  effortConfigOption,
  selectConfigOption,
} from '../state/session-config';
import {
  AgentInput,
  type AgentInputProps,
  ComposerNotice,
  type QueuedPromptItem,
  QueuedPrompts,
  UnconfirmedSendCard,
} from '../ui';
import { PermissionRequest } from './PermissionRequest';
import { promptActionOf } from './prompt-action';
import { ToolApprovalRequest } from './ToolApprovalRequest';

export function AgentComposer(props: {
  /**
   * Whether the composer opens focused. The block adapter decides, from the
   * split layout and j/k navigation — same contract as Chat and Channel.
   */
  autofocus?: boolean;
  input?: Component<AgentInputProps>;
}) {
  const Input = props.input ?? AgentInput;
  const {
    session,
    selectModel,
    displayName,
    userId,
    interactions,
    toolApprovals,
    issue,
    loadFailed,
    messages,
    metadata,
    pending,
    queue,
    steer,
    steerFailed,
    turn,
    registerQuoteInsert,
    initialInput,
    sessionId,
    unconfirmed = () => [],
    dropUnconfirmed = () => {},
  } = useAgentSession();
  const persistedDraft = createSessionComposerDraft(
    sessionId,
    () => initialInput
  );
  const changes = useOptionalChanges();
  const readOnly = () => session()?.canEdit === false;

  // Why the last message this composer sent came back, when the harness
  // said: shown above the input while that message is still in it, so until
  // the next send, the box is emptied of text and files, or the composer
  // moves to another session.
  const [refusal, setRefusal] = createSignal<string>();
  createEffect(on(sessionId, () => setRefusal(undefined), { defer: true }));

  // The fold speculates the action the moment it is issued, so success is
  // observed there; only a refusal needs saying here. Resolves whether the
  // harness took the action, and its reason when it refused, so a refused
  // prompt can go back to the draft.
  // Sends with no clear answer that their session is still checking, by
  // session: the notice shows only for the session on screen.
  const [checks, setChecks] = createSignal<string[]>([]);
  const checking = () => checks().includes(sessionId() ?? '');

  const act = async (
    action: AgentAction,
    failure: string
  ): Promise<{ taken: boolean; refusal?: string }> => {
    if (readOnly()) return { taken: false };
    try {
      const checked = sessionId() ?? '';
      let started = false;
      let result: Awaited<ReturnType<typeof issue>>;
      try {
        result = await issue(action, {
          onChecking: () => {
            started = true;
            setChecks((all) => [...all, checked]);
          },
        });
      } finally {
        if (started)
          setChecks((all) => {
            const index = all.indexOf(checked);
            return all.filter((_, at) => at !== index);
          });
      }
      if (!result?.isErr()) return { taken: true };
      // Possibly sent: never put it back, or a resend could run it twice.
      const unconfirmed = result.error.find(
        (error) => error.code === SEND_OUTCOME_UNKNOWN
      );
      // The card for it (below) keeps the text instead.
      if (unconfirmed) return { taken: true };
      // A stopped agent says why in the transcript instead of a toast.
      const refused = result.error.find(isNoRuntimeAccessError);
      if (refused) return { taken: false, refusal: refused.message };
      toast.failure(failure);
    } catch {
      toast.failure(failure);
    }
    return { taken: false };
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
  /** Macro's tier option, when the current model offers more than standard.
   * Other harnesses' speed values are theirs to interpret, so they are left alone. */
  const speedOption = () => {
    if (!isMacroHarness(session()?.harness)) return;
    const option = selectConfigOption(
      metadata()?.configOptions ?? [],
      'speed',
      'speed'
    );
    const offered = nativeSpeeds(
      option?.options.map((choice) => choice.value) ?? []
    );
    return option && offered ? { id: option.id, option, offered } : undefined;
  };
  const speed = () => {
    const tiers = speedOption();
    return tiers ? resolveSpeed(preferredSpeed(), tiers.offered) : undefined;
  };
  const changingEffort = () => {
    const option = effort();
    return option ? changingConfig(messages(), option.id) : undefined;
  };

  const catalog = createMemo(() =>
    (metadata()?.supportedModels ?? []).map((option) => ({
      id: option.id,
      label: modelLabel(option.id, option.name, option.description),
      group: option.group ?? undefined,
    }))
  );

  // A turn is open in some form: the send button becomes a stop square and
  // prompts sent now wait in the server queue behind it. A stop the fold has
  // speculated already reads as done - the button goes back to send with the
  // rest of the transcript, and the log confirms the end of the turn later.
  const busy = () => {
    const state = turn();
    return (
      state === 'starting' ||
      state === 'running' ||
      state === 'blocked' ||
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
  const attachmentTracker = createSessionAttachmentTracker(sessionId);
  createEffect(() => {
    const empty =
      persistedDraft.draft().trim().length === 0 &&
      attachmentTracker.attachments().length === 0;
    if (empty) setRefusal(undefined);
  });
  const attachFiles = (files: File[]) => {
    if (readOnly()) return;
    fireAndForget(
      uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: (file) =>
          uploadFile(file, 'static', { hideProgressIndicator: true }),
      }),
      'agent-composer'
    );
  };
  // Attachments ride the prompt action itself, so they take the same path as
  // the text: issued once, speculated by the fold, and queued server-side
  // behind a running turn with the files still on them.
  const send = async (markdown: string, attachments: InputAttachmentData[]) => {
    if (readOnly() || configuring()) return;
    setRefusal(undefined);
    // Read the session now: the answer can outlive a switch. A message that
    // comes back goes ahead of anything typed meanwhile.
    const sentTo = sessionId();
    const meta = metadata();
    const tiers = speedOption();
    const tier = speed();
    if (meta?.model && tiers && tier && tiers.option.currentValue !== tier) {
      setConfiguring(true);
      try {
        await selectModel(meta.model, { configId: tiers.id, value: tier });
      } catch {
        persistedDraft.restore(sentTo, markdown);
        toast.failure('The speed setting could not be applied. Please retry.');
        return;
      } finally {
        setConfiguring(false);
      }
    }
    if (readOnly()) {
      persistedDraft.restore(sentTo, markdown);
      return;
    }
    // Queued review notes ride this send: taking them here marks them sent
    // before the prompt is issued, so a second Enter cannot post them again
    // as their own queued prompt (which would then stop-and-flush).
    const notes = changes?.consumeSendableNotes() ?? '';
    const prompt = [markdown, notes]
      .filter((part) => part.length > 0)
      .join('\n\n');
    // The composer clears at once, as a sent message reads as sent; the
    // fold shows it pending. A failed or refused send retracts any such
    // bubble, so the message comes back here rather than vanishing.
    attachmentTracker.clearAttachments();
    const sent = await act(
      promptActionOf(prompt, attachments),
      'The message could not be sent'
    );
    // Back in front of whatever was typed meanwhile, with its files, in the
    // session it was sent to even if this composer has gone since.
    if (sent.taken) return;
    persistedDraft.restore(sentTo, prompt);
    attachmentTracker.restore(sentTo, attachments);
    // Only a reason replaces one: a later send failing for no stated reason
    // leaves an earlier refusal's reason with its returned message.
    if (sent.refusal && sessionId() === sentTo) setRefusal(sent.refusal);
  };

  // An unconfirmed prompt sent again on purpose: a new send with a new id.
  // Refused, its text comes back like any refused message.
  const sendAgain = async (sent: UnconfirmedSend) => {
    dropUnconfirmed(sent.actionId);
    const sentTo = sessionId();
    setRefusal(undefined);
    const outcome = await act(sent.action, 'The message could not be sent');
    if (outcome.taken || sent.action.type !== 'prompt') return;
    // The files went up already; only the text needs a home again.
    persistedDraft.restore(sentTo, sent.action.prompt);
    if (outcome.refusal && sessionId() === sentTo) setRefusal(outcome.refusal);
  };

  // Focus plumbing between the input and the queue list above it: Up at the
  // start of the input lands on the bottom (next-to-dispatch) queue row, and
  // Down past that row comes back. Plain variables, read only at call time.
  let focusQueueBottom: (() => void) | undefined;
  let focusInput: (() => void) | undefined;
  const restoreInputFocus = (event: Event) => {
    if (!isTouchDevice()) return;
    event.preventDefault();
    focusInput?.();
  };

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
        sendFailed: steerFailed().has(entry.actionId),
      };
    });

  return (
    <>
      <Show when={queuedItems().length > 0}>
        <div class="pb-1.5">
          <div class="mb-1 px-1 text-xs text-ink-muted">
            {queuedItems().length} queued
          </div>
          <div class="max-h-[25dvh] overflow-y-auto overscroll-contain">
            <QueuedPrompts
              items={queuedItems()}
              disabled={readOnly()}
              onEdit={(actionId, prompt) =>
                readOnly() ? undefined : queue.edit(actionId, prompt)
              }
              onRemove={(actionId) => {
                if (!readOnly())
                  fireAndForget(queue.remove(actionId), 'agent-composer');
              }}
              onSteer={
                (busy() || turn() === 'stopping') && !readOnly()
                  ? (actionId) => steer(actionId)
                  : undefined
              }
              onNavigateBelow={() => focusInput?.()}
              registerFocusFromBelow={(focus) => {
                focusQueueBottom = focus;
              }}
            />
          </div>
        </div>
      </Show>
      {/* Mounted throughout, so a reason that appears is announced, and out
          of the column's flow while empty, so it adds no gap. The harness's
          reasons say what to do at the end; they wrap, never cut. */}
      <div role="status" aria-live="polite" class="min-w-0 empty:absolute">
        <Show when={refusal()}>
          {(reason) => (
            <p class="pb-2 text-xs text-ink-extra-muted wrap-anywhere">
              Not sent: {reason()}
            </p>
          )}
        </Show>
      </div>
      <Show when={checking()}>
        <ComposerNotice text="Checking whether it was sent…" active />
      </Show>
      <For each={unconfirmed()}>
        {(sent) => (
          <UnconfirmedSendCard
            text={sent.action.type === 'prompt' ? sent.action.prompt : ''}
            attachmentCount={
              sent.action.type === 'prompt'
                ? (sent.action.attachments?.length ?? 0)
                : 0
            }
            onCopy={() =>
              fireAndForget(
                navigator.clipboard.writeText(
                  sent.action.type === 'prompt' ? sent.action.prompt : ''
                ),
                'agent-composer'
              )
            }
            onSendAgain={() => fireAndForget(sendAgain(sent), 'agent-composer')}
            onDismiss={() => dropUnconfirmed(sent.actionId)}
          />
        )}
      </For>
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
      <For each={toolApprovals.pending()}>
        {(approval) => (
          <div class="mb-2 min-w-0">
            <ToolApprovalRequest request={approval} />
          </div>
        )}
      </For>
      <Input
        initialInput={initialInput}
        draft={persistedDraft.draft()}
        onDraftChange={persistedDraft.setDraft}
        placeholder={
          readOnly()
            ? 'You have view-only access to this agent session'
            : 'Message the agent, @mention anything'
        }
        readOnly={readOnly()}
        autofocus={props.autofocus}
        busy={busy()}
        // Prompts go straight to the service, so sending needs a session to
        // post to — a block whose create is still on the wire can be typed
        // into, but not sent from, until the id lands.
        disabled={loadFailed() || pending() || readOnly() || configuring()}
        commands={() => metadata()?.availableCommands ?? []}
        onSend={(markdown, attachments) =>
          fireAndForget(send(markdown, attachments), 'agent-composer')
        }
        onStop={() =>
          fireAndForget(
            act({ type: 'stop' }, 'The agent could not be stopped'),
            'agent-composer'
          )
        }
        modelName={catalogModelLabel(
          metadata()?.model ?? undefined,
          metadata()?.supportedModels ?? []
        )}
        supportsImages={
          metadata()?.supportedModels.find(
            (model) => model.id === metadata()?.model
          )?.supportsImages
        }
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
          <UnifiedModelSelector
            state={{
              model:
                changingModel(messages(), metadata()?.model ?? null) ??
                metadata()?.model ??
                undefined,
              models: catalog(),
              suggestedModels: catalog(),
              effort: effort(),
              effortValue: changingEffort(),
              effortDisabled:
                changingModel(messages(), metadata()?.model ?? null) !==
                undefined,
              speeds: speedOption()?.option.options.map(
                (option) => option.value
              ),
              speedValue: speed(),
              disabled:
                loadFailed() ||
                readOnly() ||
                pending() ||
                configuring() ||
                changingEffort() !== undefined,
              onModel: (model) =>
                fireAndForget(chooseModel(model), 'agent-composer'),
              onEffort: (choice) => {
                if (
                  changingModel(messages(), metadata()?.model ?? null) !==
                  undefined
                )
                  return;
                const model = metadata()?.model;
                if (model)
                  fireAndForget(chooseModel(model, choice), 'agent-composer');
              },
              onSpeed: setPreferredSpeed,
              onCloseAutoFocus: restoreInputFocus,
            }}
          />
        }
      />
    </>
  );
}
