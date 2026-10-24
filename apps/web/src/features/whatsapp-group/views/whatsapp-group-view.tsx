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
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import type {
  MessageActionContext,
  MessageActions,
} from '@core/messages/types';
import type { IUser } from '@core/user/types';
import { fireAndForget } from '@core/util/fireAndForget';
import ShareFatIcon from '@phosphor/share-fat.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { Button, ConfirmDialog } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  mapArray,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { InboundAttachmentPlaceholder } from '../components/inbound-attachment';
import {
  InboundMedia,
  type InboundMediaFile,
} from '../components/inbound-media';
import { RichCard } from '../components/rich-cards';
import { WhatsAppSystemLine } from '../components/system-line';
import { useWhatsAppGroup } from '../context/whatsapp-group-context';
import { type InboundAttachment, inlineMediaKind } from '../core/attachments';
import { whatsappToMarkdown } from '../core/formatting';
import {
  backfillStatus,
  canChangeMessage,
  composerNote,
  composerPlaceholder,
  type GroupDetail,
  type GroupMessage,
  historyStartNote,
} from '../core/group';
import { mentionToken } from '../core/mentions';
import { groupMessageData, senderKey } from '../core/message-data';
import { richPreview } from '../core/rich';
import {
  type ConversationTarget,
  createConversation,
  type Draft,
} from '../primitives/conversation';

/**
 * WhatsApp carries text, formatting, files and mentions of the group's own
 * participants; nothing Macro-only.
 */
const WHATSAPP_COMPOSER = {
  mentions: 'participants',
  createItems: false,
  gifs: false,
  richBlocks: false,
} as const;

/**
 * The group's WhatsApp participants as the composer's `@` people, minus the
 * sender. The chip carries the participant id; sending turns it into
 * `@<digits>` and a WhatsApp mention.
 */
function mentionable(group: GroupDetail): IUser[] {
  const own = group.phone?.replace(/\D/g, '');
  return group.members.flatMap((member) => {
    const phone = `+${mentionToken(member.id)}`;
    if (own && mentionToken(member.id) === own) return [];
    return [{ id: member.id, name: member.name, email: phone }];
  });
}

/** A draft the conversation refused; the composer keeps it. */
class DraftRefusal extends Error {}

function quotePreview(message: GroupMessage) {
  if (message.deleted) return 'Deleted message';
  if (message.body) return message.body;
  if (message.rich) return richPreview(message.rich);
  const attachment = message.attachments[0];
  if (!attachment) return 'Attachment';
  return match(attachment.presentation)
    .with('sticker', () => 'Sticker')
    .with('gif', () => 'GIF')
    .with('voice_note', () => 'Voice note')
    .with(undefined, () => attachment.fileName)
    .exhaustive();
}

/** WhatsApp's own "Forwarded" mark, above the message. */
function ForwardedTag() {
  return (
    <span
      class="mb-0.5 flex items-center gap-1 text-xs text-ink-muted italic"
      data-whatsapp-forwarded
    >
      <ShareFatIcon class="size-3.5 shrink-0" aria-hidden="true" />
      Forwarded
    </span>
  );
}

/** A message's images, video and voice notes, played inline. */
function MessageMedia(props: { attachments: InboundAttachment[] }) {
  const source = useWhatsAppGroup();
  const media = createMemo(() =>
    props.attachments.flatMap((attachment) => {
      const kind = inlineMediaKind(attachment);
      return kind && attachment.documentId
        ? [{ attachment, kind, documentId: attachment.documentId }]
        : [];
    })
  );
  const files = mapArray(media, (file) => {
    const url = source.fileUrl(() => file.documentId);
    return (): InboundMediaFile => ({
      id: file.documentId,
      kind: file.kind,
      fileName: file.attachment.fileName,
      url: url.data,
      width: file.attachment.width,
      height: file.attachment.height,
      durationSeconds: file.attachment.durationSeconds,
      presentation: file.attachment.presentation,
    });
  });
  return (
    <Show when={files().length > 0}>
      <InboundMedia files={files().map((file) => file())} />
    </Show>
  );
}

export function WhatsAppGroupView(props: {
  userId?: string;
  leading?: JSX.Element;
  /** The Share control; the host owns the share dialog. */
  share: JSX.Element;
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
  let oldest: string | undefined;
  // Distance from the bottom at the last scroll, to hold the view in place
  // when imported history lands above it.
  let fromBottom = 0;
  onCleanup(() => {
    alive = false;
  });
  // Media WhatsApp sent no size for grows after it loads; a reader who was
  // at the bottom stays there. Rows with loaded media are watched for that
  // growth (it lands after the load event).
  const pinBottom = () => {
    if (alive && scroller && fromBottom < 80)
      scroller.scrollTop = scroller.scrollHeight;
  };
  const grown = new ResizeObserver(pinBottom);
  onCleanup(() => grown.disconnect());
  const holdBottom = (event: Event) => {
    const row =
      event.target instanceof Element
        ? event.target.closest('[data-message-id]')
        : null;
    if (row) grown.observe(row);
  };
  const setScroller = (element: HTMLDivElement) => {
    scroller = element;
    element.addEventListener('load', holdBottom, true);
    element.addEventListener('loadedmetadata', holdBottom, true);
  };

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
    const stored = source.timeline.data ?? [];
    const index = read
      ? stored.findIndex((message) => message.id === read)
      : -1;
    if (index >= 0) return index + 1;
    if (!unread) return -1;
    // System lines never count as unread: the first new row is the
    // `unread`-th message from the end.
    let remaining = unread;
    for (let at = stored.length - 1; at >= 0; at--) {
      if (stored[at]?.kind === 'system') continue;
      remaining--;
      if (remaining === 0) return at;
    }
    return 0;
  };
  const listMeta = createMemo(() => {
    const firstNew = unreadIndex();
    const newIds = new Set(
      firstNew < 0
        ? []
        : (source.timeline.data ?? []).slice(firstNew).map((row) => row.id)
    );
    return buildChannelMessageListMeta(
      rows().map((message) =>
        message.kind === 'system'
          ? {
              type: 'activity' as const,
              activity: { id: message.id, occurred_at: message.sentAt },
            }
          : {
              type: 'message' as const,
              message: {
                id: message.id,
                sender_id: senderKey(message),
                created_at: message.sentAt,
                attachments: [],
                deleted_at: message.deleted ? message.sentAt : null,
              },
            }
      ),
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
  createEffect(() => {
    const first = rows()[0]?.id;
    const grewAbove = !!oldest && !!first && first !== oldest;
    oldest = first;
    if (!grewAbove || !scroller) return;
    scroller.scrollTop =
      scroller.scrollHeight - scroller.clientHeight - fromBottom;
  });
  const memberLabel = () => {
    const count = source.group.data?.members.length;
    if (count === undefined) return 'Members';
    return count === 1 ? '1 member' : `${count} members`;
  };
  const importing = () =>
    backfillStatus(
      source.group.data?.backfill,
      source.group.data?.accessLevel === 'owner'
    );
  const historyStart = () =>
    source.hasOlder()
      ? undefined
      : historyStartNote(source.group.data?.backfill);
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
      <header class="flex h-12 shrink-0 items-center gap-2 px-3 touch:px-(--mobile-chrome-gutter)">
        {props.leading}
        <span
          aria-hidden="true"
          class="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-[#fff]"
        >
          <WhatsappIcon class="size-3" />
        </span>
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 class="ph-no-capture min-w-0 truncate text-sm font-semibold">
            {source.group.data?.name ?? 'WhatsApp group'}
          </h1>
          <span class="shrink-0 truncate text-xs text-ink-extra-muted mobile:hidden">
            WhatsApp
            <Show when={importing()}>{(status) => <> · {status()}</>}</Show>
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <HeaderActionButton
            label={memberLabel()}
            icon={<UsersThreeIcon />}
            tooltip="WhatsApp members"
            onClick={() => setRoster((value) => !value)}
          />
          {props.share}
        </div>
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
            ref={setScroller}
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 [overflow-anchor:none] mobile:pb-(--mobile-content-inset-bottom)"
            role="log"
            aria-label="WhatsApp messages"
            onScroll={() => {
              if (!scroller) return;
              fromBottom =
                scroller.scrollHeight -
                scroller.scrollTop -
                scroller.clientHeight;
              if (fromBottom < 60) markRead();
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
            <Show when={source.timeline.data && !source.hasOlder()}>
              <Show when={importing() ?? historyStart()}>
                {(note) => (
                  <p
                    role="status"
                    class="p-3 text-center text-xs text-ink-muted"
                  >
                    {note()}
                  </p>
                )}
              </Show>
            </Show>
            <Show
              when={source.timeline.data && rows().length === 0 && !importing()}
            >
              <p class="p-6 text-center text-sm text-ink-muted">
                No messages yet. New WhatsApp messages will appear here.
              </p>
            </Show>
            <For each={rows()}>
              {(message) => {
                const systemLine = () =>
                  message.kind === 'system' && message.rich?.type === 'system'
                    ? message.rich
                    : undefined;
                const meta = () =>
                  listMeta()[
                    message.kind === 'system'
                      ? `activity:${message.id}`
                      : message.id
                  ];
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
                  <Show
                    when={message.kind !== 'system'}
                    fallback={
                      <>
                        <DateDivider
                          createdAt={message.sentAt}
                          listMeta={meta()}
                        />
                        <Show when={systemLine()}>
                          {(line) => (
                            <WhatsAppSystemLine
                              id={message.id}
                              line={line()}
                              occurredAt={message.sentAt}
                            />
                          )}
                        </Show>
                      </>
                    }
                  >
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
                          <Show when={!message.deleted && message.forwarded}>
                            <ForwardedTag />
                          </Show>
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
                          <Show when={!message.deleted && message.rich}>
                            {(rich) => <RichCard rich={rich()} />}
                          </Show>
                          <MessageMedia attachments={message.attachments} />
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
                  </Show>
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
                      placeholder: composerPlaceholder(group()),
                    }}
                    features={WHATSAPP_COMPOSER}
                    participants={() => mentionable(group())}
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
