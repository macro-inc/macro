import { Layout } from '@channel/Input/Layout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { openFilePicker } from '@core/util/upload';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { Button, ComposerSurface, SendButton } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { ReplySource } from '../context/reply-source';
import { accountHealthMessage } from '../core/account-health';
import type {
  ChannelInteraction,
  ConversationAccount,
  ReplyRequest,
  ReplyAttempt as SendAttempt,
} from '../core/conversation';
import { messagingError, providerName } from '../core/delivery';
import { createReplyDraft, emptyReplyDraft } from '../primitives/reply-draft';
import { createReplyEligibility } from '../primitives/reply-eligibility';

export type MessagingComposerProps = {
  channelId: string;
  children: JSX.Element;
  interaction: ChannelInteraction;
  userId: string | undefined;
  createSource: (channelId: string) => ReplySource;
  onRefresh: () => void;
  onRecoverReady: (recover: (send: SendAttempt) => void) => () => void;
};

/** Customer channels expose one external composer; ordinary Macro channels keep their native input. */
export function ChannelMessagingComposer(props: MessagingComposerProps) {
  return (
    <Show
      when={props.channelId && JSON.stringify([props.userId, props.channelId])}
      keyed
    >
      {(_identity) => {
        const channelId = props.channelId;
        const draftUserId = props.userId;
        return (
          <Suspense
            fallback={
              <div class="w-full h-16" aria-label="Loading conversation" />
            }
          >
            <MessagingComposer
              {...props}
              channelId={channelId}
              draftUserId={draftUserId}
            >
              {props.children}
            </MessagingComposer>
          </Suspense>
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
        <div class="w-full h-16" aria-label="Loading conversation" />
      </Match>
      <Match when={props.interaction.kind === 'error'}>
        <p role="status" class="px-3 py-2 text-sm text-ink-muted">
          Conversation unavailable.{' '}
          <button class="underline" onClick={props.onRefresh}>
            Try again
          </button>
        </p>
      </Match>
      <Match when={props.interaction.kind === 'internal'}>
        {props.children}
      </Match>
      <Match when={external()}>
        {(interaction) => (
          <ExternalReply
            channelId={props.channelId}
            userId={props.draftUserId}
            account={interaction().account}
            available={interaction().available}
            createSource={props.createSource}
            onRecoverReady={props.onRecoverReady}
          />
        )}
      </Match>
    </Switch>
  );
}

function ExternalReply(props: {
  channelId: string;
  userId: string | undefined;
  account: ConversationAccount;
  available: boolean;
  createSource: (channelId: string) => ReplySource;
  onRecoverReady: (recover: (send: SendAttempt) => void) => () => void;
}) {
  const source = props.createSource(props.channelId);
  const [draft, setDraft] = createReplyDraft(props.userId, props.channelId);
  const [checkedOriginalApp, setCheckedOriginalApp] = createSignal(false);
  let active = true;
  let closePicker: (() => void) | undefined;
  let textInput: HTMLTextAreaElement | undefined;
  const fitInput = () => {
    if (!textInput?.isConnected) return;
    textInput.style.height = 'auto';
    textInput.style.height = `${Math.min(textInput.scrollHeight, 225)}px`;
  };
  onCleanup(() => {
    active = false;
    closePicker?.();
  });
  onMount(() => onCleanup(props.onRecoverReady(restoreReply)));
  const [error, setError] = createSignal('');
  const eligible = createReplyEligibility(() => props.account.eligibility);
  const supports = (mode: 'approved_template' | 'human_support') =>
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
    fitInput();
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
              /permission|not configured|reconnect|attachment/.test(e.message)
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
      fitInput();
      textInput?.focus();
    });
  }

  async function send() {
    if (!active || !allowed() || source.isSending()) return;
    const focusAtSend = document.activeElement;
    const id = draft.intent ?? crypto.randomUUID();
    setDraft('intent', id);
    setError('');
    const template = selected();
    const request: ReplyRequest = {
      idempotency_key: id,
      human_support: mode() === 'human_support',
      message:
        needsTemplate() && template
          ? {
              type: 'template',
              template_id: template.id,
              language: template.language,
              parameters: [...draft.parameters],
            }
          : draft.attachment
            ? {
                type: 'media',
                document_id: draft.attachment!.document_id,
                kind: draft.attachment!.kind,
                caption: draft.text.trim() || null,
              }
            : { type: 'text', text: draft.text },
    };
    try {
      await source.send(request);
      if (!active) return;
      // A template does not include the separate text draft; keep it for later.
      const sentTemplate = request.message.type === 'template';
      setDraft({
        ...emptyReplyDraft(),
        text: sentTemplate ? draft.text : '',
        attachment: sentTemplate ? draft.attachment : undefined,
        intent: undefined,
      });
      setCheckedOriginalApp(false);
    } catch (e) {
      if (!active) return;
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
        fitInput();
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
    <ComposerSurface>
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
            <Show when={!props.available}>
              <p role="status" class="text-sm text-ink-muted">
                Connection unavailable. Your draft is saved here; sending will
                resume when the connection returns.
              </p>
            </Show>
            <Show when={draft.uncertainReply}>
              <label class="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={source.isSending()}
                  checked={checkedOriginalApp()}
                  onChange={(e) =>
                    setCheckedOriginalApp(e.currentTarget.checked)
                  }
                />
                I checked {providerName(props.account.provider)} and want to
                send this again. The previous reply may already have arrived.
              </label>
            </Show>
            <Show when={!connected()}>
              <p role="status" class="text-sm text-ink-muted">
                {props.account.status === 'connecting'
                  ? 'Finishing the account connection. You can write a draft while you wait.'
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
                Only channel participants who belong to the connected account’s
                team can reply externally.
              </p>
            </Show>
            <Show
              when={needsTemplate()}
              fallback={
                <>
                  <Show
                    when={!draft.attachment || mediaCapability()?.caption_limit}
                  >
                    <textarea
                      ref={(element) => {
                        textInput = element;
                        queueMicrotask(fitInput);
                      }}
                      rows={1}
                      class="block w-full resize-none min-h-6 bg-transparent p-0 text-base leading-6 text-composer-ink placeholder:text-ink-placeholder outline-none"
                      aria-label="External customer reply"
                      placeholder={`Message ${props.account.conversation.customer_display_name ?? props.account.conversation.customer_handle ?? props.account.conversation.customer_phone ?? props.account.conversation.customer_id}…`}
                      value={draft.text}
                      onInput={(e) => changeText(e.currentTarget.value)}
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
                      disabled={source.isSending()}
                    />
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
                      <Match when={templateOffered()}>
                        <p class="text-xs text-ink-muted">
                          The reply window is closed. Send an approved template,
                          or wait for a new customer message.{' '}
                          <button
                            type="button"
                            class="underline"
                            disabled={source.isSending()}
                            onClick={() => chooseTemplateMode(true)}
                          >
                            Choose template
                          </button>
                        </p>
                      </Match>
                      <Match when={withinHumanWindow()}>
                        <label class="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            disabled={source.isSending()}
                            checked={draft.humanSupport}
                            onChange={(e) => {
                              setDraft('humanSupport', e.currentTarget.checked);
                              setDraft('intent', undefined);
                            }}
                          />
                          This is a human-authored reply to an unresolved
                          support request. It is not automated or promotional.
                        </label>
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
                <button
                  type="button"
                  class="underline"
                  disabled={source.isSending()}
                  onClick={() => chooseTemplateMode(false)}
                >
                  Back to text reply
                </button>
              </p>
              <label class="text-xs">
                Approved template
                <select
                  class="mt-1 w-full bg-input border border-edge-muted rounded p-2 text-sm"
                  aria-label={`Approved ${providerName(props.account.provider)} template`}
                  disabled={source.isSending()}
                  value={draft.templateId}
                  onChange={(e) => {
                    setDraft('templateId', e.currentTarget.value);
                    setDraft('parameters', []);
                    setDraft('intent', undefined);
                  }}
                >
                  <option value="">Choose a template and language</option>
                  <For each={approved()}>
                    {(t) => (
                      <option
                        value={t.id}
                        disabled={!!t.unsupported_reason}
                        // Options load after a restored draft sets the select's value.
                        selected={t.id === draft.templateId}
                      >
                        {t.name} · {t.language}
                        {t.unsupported_reason ? ' · Unsupported format' : ''}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <Show when={selected()}>
                {(t) => (
                  <pre class="whitespace-pre-wrap break-words text-xs text-ink-muted max-h-32 overflow-auto">
                    {t().preview}
                  </pre>
                )}
              </Show>
              <For each={parameterLabels()}>
                {(label, index) => (
                  <label class="text-xs capitalize">
                    {label}
                    <input
                      disabled={source.isSending()}
                      class="mt-1 w-full bg-input border border-edge-muted rounded p-2 text-sm"
                      value={draft.parameters[index()] ?? ''}
                      onInput={(e) => {
                        // Dense, so fields filled out of order never leave holes.
                        const next = parameterLabels().map(
                          (_, i) => draft.parameters[i] ?? ''
                        );
                        next[index()] = e.currentTarget.value;
                        setDraft('parameters', next);
                        setDraft('intent', undefined);
                      }}
                    />
                  </label>
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
                  <button
                    class="underline"
                    onClick={() => void templates.refresh()}
                  >
                    Retry
                  </button>
                </p>
              </Show>
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
