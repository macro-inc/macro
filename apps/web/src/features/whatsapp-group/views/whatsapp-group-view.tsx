import { buildChannelMessageListMeta } from '@channel/Channel/message-list-meta';
import { ChannelInput } from '@channel/Input/ChannelInput';
import { ChannelInputContainer } from '@channel/Input/ChannelInputContainer';
import { InputFlag } from '@channel/Input/InputFlag';
import type { InputHandle, InputSnapshot } from '@channel/Input/types';
import { hasSendableInputContent } from '@channel/Input/utils/sendable-content';
import { ChannelMessage } from '@channel/Message/ChannelMessage';
import { DateDivider } from '@channel/Message/DateDivider';
import { NewDivider } from '@channel/Message/NewDivider';
import { SenderName } from '@channel/Message/SenderName';
import { MaybeMessageActionDrawerManager } from '@channel/Mobile/MessageActionDrawerManager';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import type {
  MessageActionContext,
  MessageActions,
} from '@core/messages/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, ConfirmDialog } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { InboundAttachmentPlaceholder } from '../components/inbound-attachment';
import { useWhatsAppGroup } from '../context/whatsapp-group-context';
import { whatsappToMarkdown } from '../core/formatting';
import {
  canChangeMessage,
  composerNote,
  type GroupMessage,
} from '../core/group';
import { groupMessageData, senderKey } from '../core/message-data';
import {
  type ConversationTarget,
  createConversation,
  type Draft,
} from '../primitives/conversation';

/** WhatsApp carries text, formatting and files; nothing Macro-only. */
const WHATSAPP_COMPOSER = {
  mentions: false,
  createItems: false,
  gifs: false,
  richBlocks: false,
} as const;

/** A draft the conversation refused; the composer keeps it. */
class DraftRefusal extends Error {}

function quotePreview(message: GroupMessage) {
  if (message.deleted) return 'Deleted message';
  return message.body || message.attachments[0]?.fileName || 'Attachment';
}

export function WhatsAppGroupView(props: {
  userId?: string;
  leading?: JSX.Element;
  onShare: () => void;
  onConnect: () => void;
}) {
  const source = useWhatsAppGroup();
  let input: InputHandle | undefined;
  const [inputSnapshot, setInputSnapshot] = createSignal<InputSnapshot>();
  // The composer's own attachment rows, to put back with a restored draft.
  const snapshots = new WeakMap<Draft, InputSnapshot>();
  const conversation = createConversation(source, () => props.userId, {
    notify: (message) => toast.failure(message),
    restore: (draft, target) => {
      const snapshot = snapshots.get(draft);
      const current = inputSnapshot();
      if (!input || !snapshot || (current && hasSendableInputContent(current)))
        return;
      input.restoreSnapshot(snapshot);
      if (target && !conversation.target()) setTarget(target);
    },
  });
  const [deleting, setDeleting] = createSignal<string>();
  const [roster, setRoster] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [stopped, setStopped] = createSignal(false);
  const [stopError, setStopError] = createSignal<string>();
  const [stopPending, setStopPending] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let alive = true;
  let newest: string | undefined;
  onCleanup(() => {
    alive = false;
  });

  /** Choosing a reply or an edit puts the composer in that mode. */
  const setTarget = (target: ConversationTarget | undefined) => {
    const previous = conversation.target();
    if (!target) {
      conversation.cancelTarget();
      if (previous?.kind === 'edit') input?.clear();
      return;
    }
    if (target.kind === 'reply') conversation.reply(target.message);
    else {
      conversation.edit(target.message);
      input?.restoreSnapshot(
        {
          value: whatsappToMarkdown(target.message.body),
          mentions: [],
          attachments: [],
        },
        { cursor: 'trailing-paragraph' }
      );
    }
    input?.focus();
  };

  const nearBottom = () =>
    !scroller ||
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  const markRead = () =>
    fireAndForget(conversation.markRead(), 'whatsapp-group.read');
  const rows = conversation.rows;
  const storedCount = () => source.timeline.data?.length ?? 0;
  const unreadIndex = () => {
    const unread = conversation.initialUnreadCount();
    const read = conversation.initialRead();
    const index = read
      ? (source.timeline.data ?? []).findIndex((message) => message.id === read)
      : -1;
    if (index >= 0) return index + 1;
    return unread ? Math.max(0, storedCount() - unread) : -1;
  };
  const listMeta = createMemo(() => {
    const firstNew = unreadIndex();
    const newIds = new Set(
      firstNew < 0
        ? []
        : (source.timeline.data ?? []).slice(firstNew).map((row) => row.id)
    );
    return buildChannelMessageListMeta(
      rows().map((message) => ({
        type: 'message' as const,
        message: {
          id: message.id,
          sender_id: senderKey(message),
          created_at: message.sentAt,
          attachments: [],
          deleted_at: message.deleted ? message.sentAt : null,
        },
      })),
      (message) => newIds.has(message.id),
      !source.hasOlder()
    );
  });
  const messagesById = createMemo(
    () => new Map(rows().map((message) => [message.id, message]))
  );

  onMount(() => {
    const visible = () => {
      if (nearBottom()) markRead();
    };
    document.addEventListener('visibilitychange', visible);
    onCleanup(() => document.removeEventListener('visibilitychange', visible));
  });
  createEffect(() => {
    const latest = rows().at(-1)?.id;
    if (!latest || latest === newest) return;
    const follow =
      !newest || nearBottom() || !!messagesById().get(latest)?.pending;
    newest = latest;
    queueMicrotask(() => {
      if (!alive || !follow) return;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      markRead();
    });
  });
  const older = async () => {
    const height = scroller?.scrollHeight ?? 0;
    const offset = scroller?.scrollTop ?? 0;
    await source.loadOlder();
    if (alive && scroller)
      scroller.scrollTop = offset + scroller.scrollHeight - height;
  };
  const openQuoted = async (id: string) => {
    const find = () =>
      scroller?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    try {
      while (alive && !find() && source.hasOlder()) {
        const count = storedCount();
        await older();
        if (storedCount() === count) break;
      }
      if (!alive) return;
      const row = find();
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else toast.alert('This quoted message is no longer available.');
    } catch {
      if (alive) toast.failure("Couldn't load the quoted message. Try again.");
    }
  };

  /**
   * Message rows read their actions once, when the row mounts and when its
   * menu opens. Each action is a getter so it follows the group's current
   * permissions, which can load or change after the row appears.
   */
  const actionsFor = (message: GroupMessage): MessageActions => {
    const writable = () => {
      const group = source.group.data;
      return group?.canSend &&
        !stopped() &&
        !message.pending &&
        !message.deleted
        ? group
        : undefined;
    };
    const changeable = (operation: 'edit' | 'delete') => {
      const group = writable();
      return (
        !!group &&
        canChangeMessage(message, props.userId, group, Date.now(), operation)
      );
    };
    return {
      get onReply() {
        return writable()
          ? () => setTarget({ kind: 'reply', message })
          : undefined;
      },
      get onReact() {
        return writable()?.limits.mutations.includes('reaction')
          ? ({ emoji }: MessageActionContext) => {
              if (emoji)
                fireAndForget(
                  conversation.react(message, emoji),
                  'whatsapp-group.react'
                );
            }
          : undefined;
      },
      get onEdit() {
        return changeable('edit')
          ? () => setTarget({ kind: 'edit', message })
          : undefined;
      },
      get onDelete() {
        return changeable('delete')
          ? () => {
              setDeleting(message.id);
            }
          : undefined;
      },
    };
  };

  const send = (snapshot: InputSnapshot) => {
    const draft: Draft = {
      markdown: snapshot.value,
      attachments: snapshot.attachments.map((file) => ({
        id: file.id,
        name: file.name,
      })),
    };
    snapshots.set(draft, snapshot);
    const delivery = conversation.submit(draft);
    if (delivery.isErr()) throw new DraftRefusal(delivery.error);
    fireAndForget(delivery.value, 'whatsapp-group.send');
  };

  return (
    <div
      class="flex h-full min-h-0 min-w-0 flex-col bg-panel text-ink touch:pt-(--mobile-content-inset-top)"
      style={{ '--user-icon-width': '32px', '--message-padding-x': '16px' }}
    >
      <header class="flex min-h-14 shrink-0 items-center gap-2 border-b border-edge-muted px-4">
        {props.leading}
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-sm font-semibold">
            {source.group.data?.name ?? 'WhatsApp group'}
          </h1>
          <span class="text-xs text-ink-muted">WhatsApp</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRoster((value) => !value)}
        >
          Members
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!source.group.data}
          onClick={props.onShare}
        >
          Share
        </Button>
      </header>
      <Show when={roster()}>
        <aside class="max-h-56 shrink-0 overflow-y-auto border-b border-edge-muted p-4">
          <h2 class="mb-2 text-sm font-medium">WhatsApp members</h2>
          <p class="mb-2 text-xs text-ink-muted">
            WhatsApp membership controls who can send. Share controls who can
            read in Macro.
          </p>
          <ul class="space-y-1 text-sm">
            <For each={source.group.data?.members}>
              {(member) => (
                <li>
                  {member.name}
                  {member.admin ? ' · Admin' : ''}
                </li>
              )}
            </For>
          </ul>
          <Show when={source.group.data?.accessLevel === 'owner'}>
            <Button
              class="mt-3"
              variant="outline"
              size="sm"
              disabled={stopped()}
              onClick={() => setStopping(true)}
            >
              {stopped() ? 'Syncing stopped' : 'Stop syncing'}
            </Button>
          </Show>
        </aside>
      </Show>
      <StaticMarkdownContext>
        <MaybeMessageActionDrawerManager>
          <div
            ref={scroller}
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 [overflow-anchor:none] mobile:pb-(--mobile-content-inset-bottom)"
            role="log"
            aria-label="WhatsApp messages"
            onScroll={() => {
              if (
                scroller &&
                scroller.scrollHeight -
                  scroller.scrollTop -
                  scroller.clientHeight <
                  60
              )
                markRead();
            }}
          >
            <Show when={source.group.isPending || source.timeline.isPending}>
              <p role="status" class="p-6 text-sm text-ink-muted">
                Loading WhatsApp group…
              </p>
            </Show>
            <Show when={source.group.isError || source.timeline.isError}>
              <div class="p-4 text-sm">
                <p role="alert">
                  Couldn't load this group. You may need access from its owner.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    source.group.refetch();
                    source.timeline.refetch();
                  }}
                >
                  Try again
                </Button>
              </div>
            </Show>
            <Show when={source.hasOlder()}>
              <div class="flex justify-center p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={source.loadingOlder()}
                  onClick={() => fireAndForget(older(), 'whatsapp-group.older')}
                >
                  {source.loadingOlder() ? 'Loading…' : 'Load earlier messages'}
                </Button>
              </div>
            </Show>
            <Show when={source.timeline.data && rows().length === 0}>
              <p class="p-6 text-center text-sm text-ink-muted">
                No messages yet. New WhatsApp messages will appear here.
              </p>
            </Show>
            <For each={rows()}>
              {(message) => {
                const meta = () => listMeta()[message.id];
                const quoted = () =>
                  message.replyTo
                    ? messagesById().get(message.replyTo)
                    : undefined;
                const actions = actionsFor(message);
                const placeholders = () =>
                  message.attachments.filter(
                    (attachment) => attachment.state !== 'ready'
                  );
                return (
                  <>
                    <DateDivider createdAt={message.sentAt} listMeta={meta()} />
                    <NewDivider
                      createdAt={message.sentAt}
                      listMeta={meta()}
                      onDismiss={markRead}
                    />
                    <ChannelMessage
                      parent={{
                        type: 'whatsapp_group',
                        id: source.group.data?.id ?? '',
                      }}
                      message={groupMessageData(message, props.userId)}
                      actions={actions}
                      listMeta={meta()}
                      targeted={
                        conversation.target()?.message.id === message.id
                      }
                      renderContent={(content) => (
                        <>
                          <Show when={!message.deleted && message.replyTo}>
                            {(id) => (
                              <button
                                type="button"
                                class="mb-1 block max-w-full truncate border-l-2 border-accent py-0.5 pl-3 text-left text-xs text-ink-muted"
                                onClick={() =>
                                  fireAndForget(
                                    openQuoted(id()),
                                    'whatsapp-group.quote'
                                  )
                                }
                              >
                                <Show
                                  when={quoted()}
                                  fallback="View quoted message"
                                >
                                  {(reply) => (
                                    <>
                                      <SenderName
                                        message={groupMessageData(
                                          reply(),
                                          props.userId
                                        )}
                                      />
                                      : {quotePreview(reply())}
                                    </>
                                  )}
                                </Show>
                              </button>
                            )}
                          </Show>
                          {content}
                          <Show when={placeholders().length > 0}>
                            <div class="mt-1 flex flex-wrap gap-2">
                              <For each={placeholders()}>
                                {(attachment) => (
                                  <InboundAttachmentPlaceholder
                                    attachment={attachment}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>
                        </>
                      )}
                    />
                  </>
                );
              }}
            </For>
          </div>
        </MaybeMessageActionDrawerManager>
      </StaticMarkdownContext>
      <Show when={source.group.data}>
        {(group) => (
          <FloatRegionOrInline region="accessory">
            <Show
              when={group().canSend && !stopped()}
              fallback={
                <div class="mx-3 mb-3 flex shrink-0 flex-wrap items-center gap-2 border-t border-edge-muted px-1 pt-3 text-sm text-ink-muted touch:pointer-events-auto touch:mx-(--mobile-chrome-gutter) touch:mb-2 touch:rounded-2xl touch:border-0 touch:island touch:px-3 touch:py-2">
                  <span role="status">
                    {stopped()
                      ? 'This group is no longer syncing'
                      : composerNote(group())}
                  </span>
                  <Show
                    when={
                      group().sendReason === 'no_account' ||
                      group().sendReason === 'disconnected'
                    }
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={props.onConnect}
                    >
                      Connect WhatsApp
                    </Button>
                  </Show>
                </div>
              }
            >
              <ChannelInputContainer>
                <div class="flex w-full min-w-0 flex-col px-3 touch:px-0">
                  <p class="px-1 pb-1 text-xs text-ink-muted">
                    {composerNote(group())}
                  </p>
                  <Show when={conversation.target()}>
                    {(target) => (
                      <InputFlag
                        label={
                          target().kind === 'edit' ? (
                            'Editing message'
                          ) : (
                            <>
                              Replying to{' '}
                              <SenderName
                                message={groupMessageData(
                                  target().message,
                                  props.userId
                                )}
                              />
                            </>
                          )
                        }
                        onActivate={() =>
                          fireAndForget(
                            openQuoted(target().message.id),
                            'whatsapp-group.quote'
                          )
                        }
                        dismissLabel={
                          target().kind === 'edit'
                            ? 'Cancel edit'
                            : 'Cancel reply'
                        }
                        onDismiss={() => setTarget(undefined)}
                      />
                    )}
                  </Show>
                  <ChannelInput
                    input={{
                      mode: 'channel',
                      id: `whatsapp-group-input-${group().id}`,
                      placeholder: `Message ${group().name}`,
                    }}
                    features={WHATSAPP_COMPOSER}
                    fileAccept={group().limits.attachmentTypes.join(',')}
                    uploadAttachment={async (file) => {
                      const result = await conversation.upload(file);
                      return result.isOk()
                        ? {
                            failed: false,
                            destination: 'staged',
                            id: result.value.uploadId,
                          }
                        : { failed: true, reason: result.error };
                    }}
                    onReady={(handle) => {
                      input = handle;
                    }}
                    onChange={setInputSnapshot}
                    onSend={send}
                    onSendError={(error) =>
                      toast.failure(
                        error instanceof DraftRefusal
                          ? error.message
                          : "Couldn't send to WhatsApp. Try again."
                      )
                    }
                    onEscape={
                      conversation.target()
                        ? () => setTarget(undefined)
                        : undefined
                    }
                  />
                </div>
              </ChannelInputContainer>
            </Show>
          </FloatRegionOrInline>
        )}
      </Show>
      <ConfirmDialog
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete this message for everyone?"
        body="This also deletes the message in WhatsApp."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          const id = deleting();
          setDeleting(undefined);
          if (id) await conversation.remove(id);
        }}
      />
      <ConfirmDialog
        open={stopping()}
        onOpenChange={setStopping}
        title="Stop syncing this group?"
        body="Its history stays in Macro. New messages will stop syncing."
        confirmLabel="Stop syncing"
        tone="danger"
        pending={stopPending()}
        onConfirm={async () => {
          setStopPending(true);
          try {
            await source.stopSync();
            if (!alive) return;
            setStopped(true);
            setStopping(false);
          } catch {
            if (alive) setStopError("Couldn't stop syncing. Try again.");
          } finally {
            if (alive) setStopPending(false);
          }
        }}
      />
      <Show when={stopError()}>
        <p role="alert" class="p-2 text-xs text-failure-ink">
          {stopError()}
        </p>
      </Show>
    </div>
  );
}
