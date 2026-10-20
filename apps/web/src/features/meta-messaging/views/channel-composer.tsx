import { Layout } from '@channel/Input/Layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { openFilePicker } from '@core/util/upload';
import PaperclipIcon from '@phosphor/paperclip.svg';
import {
  Button,
  Checkbox,
  ComposerSurface,
  Select,
  SendButton,
  TextField,
} from '@ui';
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { ReplySource } from '../context/reply-source';
import { accountHealthMessage } from '../core/account-health';
import type {
  ChannelInteraction,
  ConversationAccount,
  ReplyRequest,
  ReplyTemplate,
  ReplyAttempt as SendAttempt,
} from '../core/conversation';
import { messagingError, providerName } from '../core/delivery';
import {
  createReplyDraft,
  emptyReplyDraft,
  type ReplyDraftContent,
  snapshotReplyDraft,
} from '../primitives/reply-draft';
import { createReplyEligibility } from '../primitives/reply-eligibility';

export type MessagingComposerProps = {
  channelId: string;
  channelName?: string;
  interaction: ChannelInteraction;
  userId: string | undefined;
  createSource: (channelId: string) => ReplySource;
  onRefresh: () => void;
  replyTo?: { id: string; text: string };
  onClearReply?: () => void;
  onRecoverReady: (recover: (send: SendAttempt) => void) => () => void;
};

/** Customer channels expose one external composer; ordinary Macro channels keep their native input. */
export function ChannelMessagingComposer(props: MessagingComposerProps) {
  return (
    <Show
      when={
        props.channelId &&
        JSON.stringify([
          props.userId,
          props.channelId,
          props.interaction.kind === 'external' &&
          props.interaction.account.transport === 'linked'
            ? [
                props.interaction.account.conversation.connection_id,
                props.interaction.account.authorization_generation,
              ]
            : null,
        ])
      }
      keyed
    >
      {(_identity) => {
        const channelId = props.channelId;
        const draftUserId = props.userId;
        return (
          <MessagingComposer
            {...props}
            channelId={channelId}
            draftUserId={draftUserId}
          />
        );
      }}
    </Show>
  );
}

function MessagingComposer(
  props: MessagingComposerProps & { draftUserId: string | undefined }
) {
  const external = () =>
    props.interaction.kind === 'external' ? props.interaction : undefined;
  return (
    <Switch>
      <Match when={props.interaction.kind === 'loading'}>
        <p
          role="status"
          aria-label="Loading conversation"
          class="px-3 py-2 text-sm text-ink-muted"
        >
          Loading conversation…
        </p>
      </Match>
      <Match when={props.interaction.kind === 'error'}>
        <p role="status" class="px-3 py-2 text-sm text-ink-muted">
          Conversation unavailable.{' '}
          <Button class="underline" onClick={props.onRefresh}>
            Try again
          </Button>
        </p>
      </Match>
      <Match when={external()}>
        {(interaction) => (
          <ExternalReply
            channelId={props.channelId}
            channelName={props.channelName}
            userId={props.draftUserId}
            account={interaction().account}
            available={interaction().available}
            createSource={props.createSource}
            onRecoverReady={props.onRecoverReady}
            replyTo={props.replyTo}
            onClearReply={props.onClearReply}
            onRefresh={props.onRefresh}
          />
        )}
      </Match>
    </Switch>
  );
}

function ExternalReply(props: {
  channelId: string;
  channelName?: string;
  userId: string | undefined;
  account: ConversationAccount;
  available: boolean;
  replyTo?: { id: string; text: string };
  onClearReply?: () => void;
  onRefresh: () => void;
  createSource: (channelId: string) => ReplySource;
  onRecoverReady: (recover: (send: SendAttempt) => void) => () => void;
}) {
  const source = props.createSource(props.channelId);
  const [draft, setDraft] = createReplyDraft(
    props.userId,
    props.channelId,
    props.account.transport === 'linked'
      ? `${props.account.conversation.connection_id}:${props.account.authorization_generation}`
      : undefined
  );
  const [error, setError] = createSignal('');
  createEffect(() => {
    const submitted = draft.submitted;
    if (submitted && source.isQueued(submitted.intent)) {
      setDraft('submitted', undefined);
      setError('');
    }
    if (draft.intent && source.isQueued(draft.intent)) {
      setDraft({
        ...emptyReplyDraft(),
        text: draft.templateMode ? draft.text : '',
        attachment: draft.templateMode ? draft.attachment : undefined,
        intent: undefined,
        submitted: undefined,
      });
    }
  });
  const [checkedOriginalApp, setCheckedOriginalApp] = createSignal(false);
  let active = true;
  let closePicker: (() => void) | undefined;
  let textInput: HTMLTextAreaElement | undefined;
  let container: HTMLDivElement | undefined;
  usePreserveFocusOnButtonTaps(() => container);
  useTouchOutsideToDismissKeyboard(() => container);
  onCleanup(() => {
    active = false;
    closePicker?.();
  });
  onMount(() => onCleanup(props.onRecoverReady(restoreReply)));
  const eligible = createReplyEligibility(() => props.account.eligibility);
  const supports = (mode: 'approved_template' | 'human_support') =>
    props.account.transport !== 'linked' &&
    props.account.capabilities.modes.includes(mode);
  const open = () => eligible('free_form');
  const connected = () => props.account.status === 'connected';
  const replyable = () =>
    props.available && connected() && props.account.can_reply;
  // Templates are offered only when free-form replies are blocked; choosing one
  // is explicit and never hides or discards the text draft.
  const templateOffered = () =>
    supports('approved_template') &&
    !draft.templateMode &&
    replyable() &&
    !open() &&
    eligible('approved_template');
  const needsTemplate = () =>
    supports('approved_template') && draft.templateMode;
  const chooseTemplateMode = (templateMode: boolean) => {
    setDraft('templateMode', templateMode);
    setDraft('intent', undefined);
    setError('');
  };
  const mediaCapability = () =>
    props.account.capabilities.media.find(
      (c) => c.kind === draft.attachment?.kind
    );
  const templates = source.templates(() => replyable() && needsTemplate());
  const approved = templates.items;
  const selected = () => approved().find((t) => t.id === draft.templateId);
  const parameterLabels = () => selected()?.parameter_labels ?? [];
  const withinHumanWindow = () =>
    supports('human_support') && eligible('human_support');
  // The human-support choice is visible, and applies, only outside the standard window.
  const mode = () =>
    needsTemplate()
      ? 'approved_template'
      : !open() && withinHumanWindow() && draft.humanSupport
        ? 'human_support'
        : 'free_form';
  const allowed = () =>
    !draft.submitted &&
    props.available &&
    connected() &&
    props.account.can_reply &&
    !source.isUploading() &&
    (!draft.uncertainReply || checkedOriginalApp()) &&
    props.account.capabilities.modes.includes(mode()) &&
    eligible(mode()) &&
    (needsTemplate()
      ? !!selected() &&
        !selected()?.unsupported_reason &&
        draft.parameters.length === parameterLabels().length &&
        draft.parameters.every((p) => p.trim())
      : (!draft.attachment || !!mediaCapability()) &&
        length() <= limit() &&
        (!!draft.text.trim() || !!draft.attachment));
  const limit = () =>
    draft.attachment
      ? (mediaCapability()?.caption_limit ?? 0)
      : props.account.capabilities.text_limit;
  const length = () =>
    draft.attachment || !props.account.capabilities.text_limit_in_bytes
      ? [...draft.text].length
      : new TextEncoder().encode(draft.text).length;
  const changeText = (value: string) => {
    setDraft('text', value);
    setDraft('intent', undefined);
    setError('');
  };

  function chooseAttachment() {
    closePicker?.();
    closePicker = openFilePicker(
      {
        multiple: false,
        acceptedMimeTypes: props.account.capabilities.media.flatMap(
          (c) => c.mime_types
        ),
      },
      async (files) => {
        if (!active) return;
        const file = files[0];
        if (!file) return;
        const type =
          file.type === 'audio/x-m4a'
            ? 'audio/mp4'
            : file.type === 'audio/x-wav'
              ? 'audio/wav'
              : file.type;
        const capability = props.account.capabilities.media.find((c) =>
          c.mime_types.includes(type)
        );
        if (!capability || file.size > capability.max_bytes) {
          setError(
            'This attachment type or size is unsupported for this account.'
          );
          return;
        }
        if (!capability.caption_limit && draft.text.trim()) {
          setError(
            'Send or clear your text first. This account sends this attachment separately from text.'
          );
          return;
        }
        setError('');
        try {
          const uploaded = await source.upload(file);
          if (!active) return;
          setDraft('attachment', uploaded);
          setDraft('intent', undefined);
        } catch (e) {
          if (!active) return;
          setError(
            e instanceof Error &&
              [
                'forbidden',
                'not_found',
                'configuration_required',
                'disconnected',
                'invalid_attachment',
              ].includes(e.message)
              ? messagingError(e.message, props.account.provider)
              : 'We couldn’t upload this file. Your draft is still here. Check your connection and attach the file again.'
          );
        }
      }
    );
  }

  function restoreReply(send: SendAttempt) {
    if (
      !active ||
      send.user_id !== props.userId ||
      send.channel_id !== props.channelId
    )
      return;
    if (draft.text.trim() || draft.attachment || draft.templateMode) {
      setError(
        'Your current draft is still here. Send or clear it before restoring another reply.'
      );
      queueMicrotask(() => textInput?.focus());
      return;
    }
    setDraft('intent', undefined);
    setError('');
    setDraft('attachment', undefined);
    setDraft('text', '');
    setDraft('templateMode', false);
    setDraft('uncertainReply', send.state === 'unknown');
    setCheckedOriginalApp(false);
    match(send.payload.message)
      .with({ type: 'text' }, (value) => setDraft('text', value.text))
      .with({ type: 'mutation' }, () =>
        setError('Open the original message to make a new change.')
      )
      .with({ type: 'media' }, (value) => {
        setDraft('attachment', {
          document_id: value.document_id,
          kind: value.kind,
          filename: 'Previously attached file',
        });
        setDraft('text', value.caption ?? '');
      })
      .with({ type: 'template' }, (value) => {
        setDraft('templateMode', true);
        setDraft('templateId', value.template_id);
        setDraft('parameters', value.parameters);
      })
      .exhaustive();
    setDraft('humanSupport', send.payload.human_support ?? false);
    queueMicrotask(() => {
      textInput?.focus();
    });
  }

  function requestFor(
    snapshot: ReplyDraftContent & { intent: string; templateLanguage?: string }
  ): ReplyRequest {
    return {
      idempotency_key: snapshot.intent,
      reply_to: snapshot.replyTo,
      human_support: snapshot.humanSupport,
      message: snapshot.templateMode
        ? {
            type: 'template',
            template_id: snapshot.templateId,
            language: snapshot.templateLanguage ?? '',
            parameters: [...snapshot.parameters],
          }
        : snapshot.attachment
          ? {
              type: 'media',
              document_id: snapshot.attachment.document_id,
              kind: snapshot.attachment.kind,
              caption: snapshot.text.trim() || null,
            }
          : { type: 'text', text: snapshot.text },
    };
  }

  async function send(retry = false) {
    if (
      !active ||
      source.isSending() ||
      (retry ? !draft.submitted : !allowed())
    )
      return;
    const focusAtSend = document.activeElement;
    const snapshot = retry
      ? draft.submitted!
      : {
          ...snapshotReplyDraft(draft),
          replyTo: props.replyTo?.id,
          intent: draft.intent ?? crypto.randomUUID(),
          humanSupport: mode() === 'human_support',
          templateMode: needsTemplate(),
          templateLanguage: selected()?.language,
        };
    const request = requestFor(snapshot);
    if (!retry) {
      // Persist the submission separately before giving the editor a fresh draft.
      setDraft({
        ...emptyReplyDraft(),
        text: snapshot.templateMode ? draft.text : '',
        attachment: snapshot.templateMode ? draft.attachment : undefined,
        intent: undefined,
        submitted: snapshot,
      });
    }
    const emptyAfterSubmit = JSON.stringify(snapshotReplyDraft(draft));
    setError('');
    try {
      await source.send(request);
      if (!active) return;
      props.onClearReply?.();
      setDraft('submitted', undefined);
      setCheckedOriginalApp(false);
    } catch (e) {
      if (!active) return;
      if (source.isQueued(snapshot.intent)) {
        setDraft('submitted', undefined);
        return;
      }
      // Unknown enqueue outcomes stay separate and reconcile through their original key.
      const definitive =
        e instanceof Error &&
        [
          'invalid_input',
          'invalid_attachment',
          'invalid_template',
          'configuration_required',
          'forbidden',
          'not_found',
          'conflict',
          'disconnected',
          'template_required',
          'reply_window_closed',
          'human_support_required',
          'meta_access_required',
          'provider_rejected',
        ].includes(e.message);
      if (
        !retry &&
        definitive &&
        !source.isQueued(snapshot.intent) &&
        JSON.stringify(snapshotReplyDraft(draft)) === emptyAfterSubmit
      ) {
        setDraft({ ...snapshot, submitted: undefined });
      }
      setError(
        e instanceof Error &&
          /network|failed to fetch|fetch failed|timed? ?out|timeout/i.test(
            e.message
          )
          ? 'We couldn’t confirm that your reply was queued. Your draft is still here. Check your connection and try again.'
          : messagingError(
              e instanceof Error ? e.message : undefined,
              props.account.provider
            )
      );
    } finally {
      queueMicrotask(() => {
        if (!active) return;
        if (
          textInput?.isConnected &&
          (document.activeElement === focusAtSend ||
            document.activeElement === document.body)
        ) {
          textInput.focus();
        }
      });
    }
  }

  return (
    <ComposerSurface
      ref={(element) => {
        container = element;
      }}
    >
      <Layout
        oneLineInput={
          !draft.text.includes('\n') &&
          !needsTemplate() &&
          !draft.attachment &&
          !error() &&
          connected() &&
          props.available &&
          props.account.can_reply &&
          open() &&
          !draft.uncertainReply
        }
      >
        <Layout.Body>
          <Layout.Editor class="flex flex-col gap-2">
            <Show when={props.replyTo}>
              {(quote) => (
                <div class="border-l-2 border-edge pl-2 text-xs text-ink-muted">
                  <p>{quote().text}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={props.onClearReply}
                  >
                    Cancel reply
                  </Button>
                </div>
              )}
            </Show>
            <Show when={!props.available}>
              <p role="status" class="text-sm text-ink-muted">
                Connection unavailable. Your draft is saved here; sending will
                be available when the connection returns.
              </p>
            </Show>
            <Show when={draft.uncertainReply}>
              <Checkbox
                class="items-start text-xs"
                disabled={source.isSending()}
                checked={checkedOriginalApp()}
                onChange={setCheckedOriginalApp}
              >
                <Checkbox.Control />
                <Checkbox.Label>
                  I checked {providerName(props.account.provider)} and want to
                  send this again. The previous reply may already have arrived.
                </Checkbox.Label>
              </Checkbox>
            </Show>
            <Show when={!connected()}>
              <p role="status" class="text-sm text-ink-muted">
                {props.account.status === 'connecting'
                  ? 'Finishing the account connection. You can write a draft while you wait.'
                  : props.account.transport === 'linked'
                    ? props.account.health_error === 'temporarily_offline'
                      ? 'WhatsApp is temporarily offline. Your draft is saved; reconnecting automatically.'
                      : 'Connect or reconnect your own WhatsApp account in Settings to send.'
                    : (accountHealthMessage(
                        props.account.status,
                        props.account.health_error,
                        props.account.provider
                      ) ??
                      'This account needs attention. Ask a team admin to reconnect it in Settings before sending.')}
              </p>
            </Show>
            <Show when={!props.account.can_reply}>
              <p class="text-sm text-ink-muted">
                {props.account.transport === 'linked'
                  ? 'Sending requires your own connected WhatsApp account, current group membership, and Macro channel access.'
                  : 'Only channel participants who belong to the connected account’s team can reply externally.'}
              </p>
            </Show>
            <Show
              when={needsTemplate()}
              fallback={
                <>
                  <Show
                    when={!draft.attachment || mediaCapability()?.caption_limit}
                  >
                    <TextField value={draft.text} onChange={changeText}>
                      <TextField.TextArea
                        autoResize
                        ref={(element) => {
                          textInput = element;
                        }}
                        rows={1}
                        class="block w-full resize-none min-h-6 max-h-[225px] rounded-none border-0 bg-transparent p-0 text-base leading-6 text-composer-ink placeholder:text-ink-placeholder outline-none focus-visible:shadow-none"
                        aria-label="External customer reply"
                        placeholder={
                          props.account.transport === 'linked'
                            ? props.channelName
                              ? `Message ${props.channelName}…`
                              : 'Message…'
                            : `Message ${props.account.conversation.customer_display_name ?? props.account.conversation.customer_handle ?? props.account.conversation.customer_phone ?? props.account.conversation.customer_id}…`
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.altKey &&
                            !event.isComposing &&
                            event.keyCode !== 229 &&
                            !isTouchDevice()
                          ) {
                            event.preventDefault();
                            void send();
                          }
                        }}
                      />
                    </TextField>
                  </Show>
                  <Show when={draft.attachment}>
                    {(file) => (
                      <div class="flex items-center justify-between gap-2 text-sm">
                        <span class="truncate" title={file().filename}>
                          {file().filename}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={source.isSending()}
                          onClick={() => {
                            setDraft('attachment', undefined);
                            setDraft('intent', undefined);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </Show>

                  <Show when={replyable() && !open()}>
                    <Switch
                      fallback={
                        <p class="text-xs text-ink-muted">
                          This account’s reply window is closed. Wait for a new
                          customer message.
                        </p>
                      }
                    >
                      <Match when={props.account.transport === 'linked'}>
                        <p role="status" class="text-xs text-ink-muted">
                          Sending is unavailable for this group.{' '}
                          <Button size="sm" onClick={props.onRefresh}>
                            Refresh
                          </Button>
                        </p>
                      </Match>
                      <Match when={templateOffered()}>
                        <p class="text-xs text-ink-muted">
                          The reply window is closed. Send an approved template,
                          or wait for a new customer message.{' '}
                          <Button
                            type="button"
                            class="underline"
                            disabled={source.isSending()}
                            onClick={() => chooseTemplateMode(true)}
                          >
                            Choose template
                          </Button>
                        </p>
                      </Match>
                      <Match when={withinHumanWindow()}>
                        <Checkbox
                          class="items-start text-xs"
                          disabled={source.isSending()}
                          checked={draft.humanSupport}
                          onChange={(checked) => {
                            setDraft('humanSupport', checked);
                            setDraft('intent', undefined);
                          }}
                        >
                          <Checkbox.Control />
                          <Checkbox.Label>
                            This is a human-authored reply to an unresolved
                            support request. It is not automated or promotional.
                          </Checkbox.Label>
                        </Checkbox>
                      </Match>
                    </Switch>
                  </Show>
                  <Show
                    when={
                      limit() > 0 && length() > 0 && length() > limit() * 0.8
                    }
                  >
                    <p class="text-xs text-ink-muted" aria-live="polite">
                      {length() > limit()
                        ? 'This reply is too long. Shorten it before sending.'
                        : !props.account.capabilities.text_limit_in_bytes
                          ? `${length()}/${limit()}`
                          : 'You’re close to this account’s message limit.'}
                    </p>
                  </Show>
                </>
              }
            >
              <p class="text-sm text-ink-muted">
                {open()
                  ? 'Send an approved template instead of a text reply.'
                  : 'The reply window is closed. Only an approved template can be sent.'}{' '}
                <Button
                  type="button"
                  class="underline"
                  disabled={source.isSending()}
                  onClick={() => chooseTemplateMode(false)}
                >
                  Back to text reply
                </Button>
              </p>
              <Select<ReplyTemplate>
                options={approved()}
                optionValue="id"
                optionTextValue="name"
                optionDisabled={(template) => !!template.unsupported_reason}
                value={selected() ?? null}
                disabled={source.isSending()}
                placeholder="Choose a template and language"
                onChange={(template) => {
                  if (!template || template.id === draft.templateId) return;
                  setDraft('templateId', template.id);
                  setDraft('parameters', []);
                  setDraft('intent', undefined);
                }}
              >
                <Select.Label>
                  Approved {providerName(props.account.provider)} template
                </Select.Label>
                <Select.Trigger class="w-full">
                  <Select.Value<ReplyTemplate>>
                    {(state) =>
                      `${state.selectedOption().name} · ${state.selectedOption().language}`
                    }
                  </Select.Value>
                  <Select.Icon />
                </Select.Trigger>
                <Select.Content portalScope="local">
                  <Select.Listbox />
                </Select.Content>
              </Select>
              <Show when={selected()}>
                {(t) => (
                  <pre class="whitespace-pre-wrap break-words text-xs text-ink-muted max-h-32 overflow-auto">
                    {t().preview}
                  </pre>
                )}
              </Show>
              <For each={parameterLabels()}>
                {(label, index) => (
                  <TextField
                    value={draft.parameters[index()] ?? ''}
                    onChange={(value) => {
                      const next = parameterLabels().map(
                        (_, i) => draft.parameters[i] ?? ''
                      );
                      next[index()] = value;
                      setDraft('parameters', next);
                      setDraft('intent', undefined);
                    }}
                    disabled={source.isSending()}
                  >
                    <TextField.Label class="text-xs capitalize">
                      {label}
                    </TextField.Label>
                    <TextField.Input />
                  </TextField>
                )}
              </For>
              <Show when={templates.ready() && approved().length === 0}>
                <p class="text-xs text-ink-muted">
                  No approved templates are available for this account.
                </p>
              </Show>
              <Show when={templates.failed()}>
                <p role="alert" class="text-xs text-ink-muted">
                  Templates could not load.{' '}
                  <Button
                    class="underline"
                    onClick={() => void templates.refresh()}
                  >
                    Retry
                  </Button>
                </p>
              </Show>
            </Show>

            <Show when={draft.submitted && !source.isSending()}>
              <p role="status" class="text-sm text-ink-muted">
                Your previous reply has not been confirmed. Your next draft is
                saved.
                <Button size="sm" onClick={() => void send(true)}>
                  Retry previous reply
                </Button>
                <Button
                  size="sm"
                  onClick={() => setDraft('submitted', undefined)}
                >
                  Discard previous draft
                </Button>
              </p>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-sm text-ink-muted">
                {error()}
              </p>
            </Show>
          </Layout.Editor>
        </Layout.Body>
        <Layout.ActionsLeft>
          <Show
            when={
              !needsTemplate() &&
              props.account.capabilities.max_attachments > 0 &&
              props.account.capabilities.media.length > 0
            }
          >
            <Button
              variant="ghost"
              size="icon-composer"
              aria-label={
                source.isUploading() ? 'Uploading attachment' : 'Attach file'
              }
              title="Attach file"
              disabled={
                !connected() ||
                !props.account.can_reply ||
                source.isUploading() ||
                source.isSending()
              }
              onClick={chooseAttachment}
            >
              <PaperclipIcon class="size-4" aria-hidden="true" />
            </Button>
          </Show>
        </Layout.ActionsLeft>
        <Layout.ActionsRight>
          <SendButton
            appearance="composer"
            class="touch:rounded-full"
            aria-label={
              source.isSending()
                ? 'Sending reply'
                : `Send reply via ${providerName(props.account.provider)}`
            }
            tooltip="Send message"
            shortcut="enter"
            aria-keyshortcuts="Enter Control+Enter Meta+Enter"
            disabled={!allowed() || source.isSending()}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => void send()}
          />
        </Layout.ActionsRight>
      </Layout>
    </ComposerSurface>
  );
}
