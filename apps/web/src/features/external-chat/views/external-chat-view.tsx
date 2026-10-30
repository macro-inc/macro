import { ViewShell } from '@app/components/view-shell';
import { ChannelLoading } from '@channel/Channel/ChannelLoading';
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
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import type {
  MessageActionContext,
  MessageActions,
} from '@core/messages/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import type { IUser } from '@core/user/types';
import { fireAndForget } from '@core/util/fireAndForget';
import ShareFatIcon from '@phosphor/share-fat.svg';
import TimerIcon from '@phosphor/timer.svg';
import { Button, ConfirmDialog, Tooltip } from '@ui';
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
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { ChatDetails } from '../components/chat-details';
import { AttachmentChip } from '../components/inbound-attachment';
import {
  InboundMedia,
  type InboundMediaFile,
} from '../components/inbound-media';
import { RichCard } from '../components/rich-cards';
import { ExternalChatSystemLine } from '../components/system-line';
import { useExternalChat } from '../context/external-chat-context';
import { type InboundAttachment, inlineMediaKind } from '../core/attachments';
import {
  backfillStatus,
  type ChatDetail,
  type ChatMessage,
  canChangeMessage,
  chatTitle,
  composerNote,
  composerPlaceholder,
  disappearingNote,
  historyStartNote,
} from '../core/chat';
import { mentionToken } from '../core/mentions';
import { chatMessageData, senderKey } from '../core/message-data';
import { richPreview } from '../core/rich';
import {
  type ConversationTarget,
  createConversation,
  type Draft,
} from '../primitives/conversation';
import { chatProvider } from '../providers';

/**
 * The chat's participants as the composer's `@` people, minus the sender.
 * The chip carries the participant id; sending turns it into `@<digits>` and
 * a provider mention.
 */
function mentionable(group: ChatDetail): IUser[] {
  const own = group.phone?.replace(/\D/g, '');
  return group.members.flatMap((member) => {
    const phone = `+${mentionToken(member.id)}`;
    if (own && mentionToken(member.id) === own) return [];
    return [{ id: member.id, name: member.name, email: phone }];
  });
}

/** A draft the conversation refused; the composer keeps it. */
class DraftRefusal extends Error {}

function quotePreview(message: ChatMessage) {
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

/** The provider's own "Forwarded" mark, above the message. */
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

function sameMediaFile(
  a: InboundMediaFile | undefined,
  b: InboundMediaFile | undefined
): boolean {
  if (!a || !b) return a === b;
  return (Object.keys(a) as (keyof InboundMediaFile)[]).every(
    (key) => a[key] === b[key]
  );
}

/**
 * A message's images, video and voice notes, played inline. `sent` is what
 * this page showed for a file it sent: its local preview and size stand in
 * until the stored file loads.
 */
function MessageMedia(props: {
  attachments: InboundAttachment[];
  sent?: InboundAttachment[];
}) {
  const source = useExternalChat();
  const media = createMemo(() =>
    props.attachments.flatMap((attachment, index) => {
      const local = props.sent?.[index];
      const file: InboundAttachment = local
        ? {
            ...attachment,
            previewUrl: attachment.previewUrl ?? local.previewUrl,
            width: attachment.width ?? local.width,
            height: attachment.height ?? local.height,
          }
        : attachment;
      const kind = inlineMediaKind(file);
      return kind ? [{ attachment: file, kind }] : [];
    })
  );
  const files = mapArray(
    () => media().map((file) => file.attachment.fileId ?? ''),
    (fileId, index) =>
      // One object per change, so Chat's media rows don't remount.
      createMemo(
        (): InboundMediaFile | undefined => {
          const file = media()[index()];
          if (!file) return undefined;
          return {
            id: fileId || `${file.attachment.ordinal}`,
            kind: file.kind,
            fileName: file.attachment.fileName,
            url: fileId ? source.fileUrl(fileId) : file.attachment.previewUrl,
            previewUrl: file.attachment.previewUrl,
            width: file.attachment.width,
            height: file.attachment.height,
            durationSeconds: file.attachment.durationSeconds,
            presentation: file.attachment.presentation,
          };
        },
        undefined,
        { equals: sameMediaFile }
      )
  );
  const shown = () => files().flatMap((file) => file() ?? []);
  return (
    <Show when={shown().length > 0}>
      <InboundMedia files={shown()} />
    </Show>
  );
}

export function ExternalChatView(props: {
  userId?: string;
  leading?: JSX.Element;
  /** The Share control; the host owns the share dialog. */
  share: JSX.Element;
  /** Opens the host's share dialog from the details panel. */
  onShare: () => void;
  onConnect: () => void;
}) {
  const source = useExternalChat();
  const provider = () =>
    source.chat.data ? chatProvider(source.chat.data.provider) : undefined;
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
  const sidePanel = useSidePanel();
  // The floating details card covers the right of the pane; where the pane
  // is wide enough, the timeline and composer make room for it instead.
  const detailsBeside = () => !isTouchDevice() && !!sidePanel?.isOpen();
  const [stopped, setStopped] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let alive = true;
  let newest: string | undefined;
  let oldest: string | undefined;
  // Distance from the bottom at the last scroll, to hold the view in place
  // when imported history lands above it.
  let fromBottom = 0;
  // The reader is at the bottom and stays there as rows and media grow.
  // Only the reader's own scrolling changes it: layout (media loading,
  // shrinking, clamping) fires scroll events that say nothing about intent.
  let following = true;
  let intentAt = 0;
  const intent = () => {
    intentAt = Date.now();
  };
  onCleanup(() => {
    alive = false;
  });
  // Media WhatsApp sent no size for grows after it loads; a reader who was
  // at the bottom stays there whenever the timeline's content changes size.
  const grown = new ResizeObserver(() => {
    if (alive && scroller && following)
      scroller.scrollTop = scroller.scrollHeight;
  });
  onCleanup(() => grown.disconnect());
  const [scrollerElement, setScrollerElement] = createSignal<HTMLDivElement>();
  const setScroller = (element: HTMLDivElement) => {
    scroller = element;
    setScrollerElement(element);
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
          value: provider()?.formatting.toMarkdown(target.message.body) ?? '',
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
  /** Rows render only once the chat, and so its provider, has loaded. */
  const messageData = (message: ChatMessage) =>
    chatMessageData(
      message,
      props.userId,
      provider()?.formatting.toMarkdown ?? (() => '')
    );
  const markRead = () =>
    fireAndForget(conversation.markRead(), 'external-chat.read');
  const rows = () => (source.chat.data ? conversation.rows() : []);
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
      !newest ||
      following ||
      nearBottom() ||
      !!messagesById().get(latest)?.pending;
    newest = latest;
    queueMicrotask(() => {
      if (!alive || !follow) return;
      following = true;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      markRead();
    });
  });
  createEffect(() => {
    const first = rows()[0]?.id;
    const grewAbove = !!oldest && !!first && first !== oldest;
    oldest = first;
    if (!grewAbove || !scroller || following) return;
    scroller.scrollTop =
      scroller.scrollHeight - scroller.clientHeight - fromBottom;
  });
  const importing = () =>
    backfillStatus(
      source.chat.data?.backfill,
      source.chat.data?.accessLevel === 'owner'
    );
  const historyStart = () =>
    source.hasOlder()
      ? undefined
      : source.chat.data && historyStartNote(source.chat.data);
  const older = async () => {
    following = false;
    const height = scroller?.scrollHeight ?? 0;
    const offset = scroller?.scrollTop ?? 0;
    const loaded = await source.loadOlder();
    if (alive && scroller)
      scroller.scrollTop = offset + scroller.scrollHeight - height;
    return loaded;
  };
  const openQuoted = async (id: string) => {
    const find = () =>
      scroller?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    while (alive && !find() && source.hasOlder()) {
      const count = storedCount();
      if (!(await older())) {
        if (alive)
          toast.failure("Couldn't load the quoted message. Try again.");
        return;
      }
      if (storedCount() === count) break;
    }
    if (!alive) return;
    const row = find();
    if (row) following = false;
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else toast.alert('This quoted message is no longer available.');
  };

  /**
   * Message rows read their actions once, when the row mounts and when its
   * menu opens. Each action is a getter so it follows the group's current
   * permissions, which can load or change after the row appears.
   */
  const actionsFor = (message: ChatMessage): MessageActions => {
    const writable = () => {
      const group = source.chat.data;
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
                  'external-chat.react'
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
        mime: file.mimeType,
        previewUrl: file.kind === 'document' ? undefined : file.previewSrc,
        width: file.width,
        height: file.height,
      })),
    };
    snapshots.set(draft, snapshot);
    const delivery = conversation.submit(draft);
    if (delivery.isErr()) throw new DraftRefusal(delivery.error);
    fireAndForget(delivery.value, 'external-chat.send');
  };

  return (
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-panel text-ink">
      {/* Desktop chrome is the view shell's top bar; touch keeps it as the
          page header, below the safe area. */}
      <ViewShell.TopBar class="touch:flex touch:h-auto touch:min-h-12 touch:px-(--mobile-chrome-gutter) touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]">
        {props.leading}
        <Show when={provider()}>
          {(provider) => (
            <span
              aria-hidden="true"
              class={`flex size-5 shrink-0 items-center justify-center rounded-full ${provider().badgeClass}`}
            >
              <Dynamic component={provider().icon} class="size-3" />
            </span>
          )}
        </Show>
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 class="ph-no-capture min-w-0 truncate text-sm font-semibold">
            {source.chat.data ? chatTitle(source.chat.data) : 'Chat'}
          </h1>
          <Show when={source.chat.data && disappearingNote(source.chat.data)}>
            {(note) => (
              <Tooltip
                label={note()}
                as="span"
                class="flex shrink-0 self-center"
              >
                <TimerIcon
                  class="size-3.5 text-ink-extra-muted"
                  aria-label={note()}
                  data-whatsapp-disappearing
                />
              </Tooltip>
            )}
          </Show>
          <span class="shrink-0 truncate text-xs text-ink-extra-muted mobile:hidden">
            {provider()?.label}
            <Show when={importing()}>{(status) => <> · {status()}</>}</Show>
          </span>
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
          <HeaderActionGroup label="Sharing">{props.share}</HeaderActionGroup>
          <SidePanel.Toggle />
        </div>
      </ViewShell.TopBar>
      {/* Members, sharing and syncing open in the generic floating side
          panel over the timeline, like an email thread's details. */}
      <div class="relative min-h-0 min-w-0 flex-1">
        <SidePanel.Layout headerToggle={false} floating>
          <Show when={source.chat.data}>
            {(group) => (
              <ChatDetails
                chat={group()}
                stopped={stopped()}
                onShare={props.onShare}
                onStopSync={async () => {
                  try {
                    await source.stopSync();
                  } catch {
                    toast.failure("Couldn't stop syncing. Try again.");
                    return false;
                  }
                  if (alive) setStopped(true);
                  return true;
                }}
              />
            )}
          </Show>
          <div class="@container/whatsapp-chat size-full min-h-0 min-w-0">
            <div
              style={{
                '--details-clearance': `${detailsBeside() ? SidePanel.FLOATING_CLEARANCE_PX : 0}px`,
              }}
              class="flex size-full min-h-0 min-w-0 flex-col @min-[900px]/whatsapp-chat:pr-(--details-clearance)"
            >
              <StaticMarkdownContext>
                <MaybeMessageActionDrawerManager>
                  {/* Chat's thread list layout: a full-width scroller with Chat's
              custom scrollbar, rows in the centered message column. */}
                  <div class="relative min-h-0 flex-1">
                    <div
                      ref={setScroller}
                      class="scrollbar-hidden h-full overflow-y-auto overscroll-contain px-2 pb-4 [overflow-anchor:none] mobile:pb-(--mobile-content-inset-bottom)"
                      role="log"
                      aria-label={`${provider()?.label} messages`}
                      onWheel={intent}
                      onTouchMove={intent}
                      onKeyDown={intent}
                      onPointerDown={intent}
                      onScroll={() => {
                        if (!scroller) return;
                        fromBottom =
                          scroller.scrollHeight -
                          scroller.scrollTop -
                          scroller.clientHeight;
                        if (Date.now() - intentAt < 1000)
                          following = fromBottom < 80;
                        if (fromBottom < 60) markRead();
                      }}
                    >
                      <div class="flex w-full justify-center">
                        <div
                          ref={(content) => grown.observe(content)}
                          class="macro-message-width relative"
                        >
                          <Show
                            when={
                              source.chat.isPending || source.timeline.isPending
                            }
                          >
                            {/* The header already clears the top inset. */}
                            <div class="touch:[--mobile-content-inset-top:0px]">
                              <ChannelLoading />
                            </div>
                          </Show>
                          <Show
                            when={
                              source.chat.isError || source.timeline.isError
                            }
                          >
                            <div class="p-4 text-sm">
                              <p role="alert">
                                Couldn't load this chat. You may need access
                                from its owner.
                              </p>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  source.chat.refetch();
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
                                onClick={() =>
                                  fireAndForget(older(), 'external-chat.older')
                                }
                              >
                                {source.loadingOlder()
                                  ? 'Loading…'
                                  : 'Load earlier messages'}
                              </Button>
                            </div>
                          </Show>
                          <Show
                            when={source.timeline.data && !source.hasOlder()}
                          >
                            <Show
                              when={
                                source.chat.data &&
                                disappearingNote(source.chat.data)
                              }
                            >
                              {(note) => (
                                <p class="p-3 text-center text-xs text-ink-muted">
                                  {note()}
                                </p>
                              )}
                            </Show>
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
                            when={
                              source.chat.data &&
                              source.timeline.data &&
                              rows().length === 0 &&
                              !importing()
                            }
                          >
                            <p class="p-6 text-center text-sm text-ink-muted">
                              No messages yet. New {provider()?.label} messages
                              will appear here.
                            </p>
                          </Show>
                          <For each={rows()}>
                            {(message) => {
                              const systemLine = () =>
                                message.kind === 'system' &&
                                message.rich?.type === 'system'
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
                              // Everything that doesn't play inline: files
                              // to open, and files not stored (yet).
                              const placeholders = () =>
                                message.attachments.filter(
                                  (attachment) => !inlineMediaKind(attachment)
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
                                          <ExternalChatSystemLine
                                            id={message.id}
                                            line={line()}
                                            chat={
                                              source.chat.data?.kind ?? 'group'
                                            }
                                            occurredAt={message.sentAt}
                                          />
                                        )}
                                      </Show>
                                    </>
                                  }
                                >
                                  <NewDivider
                                    createdAt={message.sentAt}
                                    listMeta={meta()}
                                    onDismiss={markRead}
                                  />
                                  <DateDivider
                                    createdAt={message.sentAt}
                                    listMeta={meta()}
                                  />
                                  <ChannelMessage
                                    timestampFormat="time"
                                    message={messageData(message)}
                                    actions={actions}
                                    listMeta={meta()}
                                    targeted={
                                      conversation.target()?.message.id ===
                                      message.id
                                    }
                                    renderContent={(content) => (
                                      <>
                                        <Show
                                          when={
                                            !message.deleted &&
                                            message.forwarded
                                          }
                                        >
                                          <ForwardedTag />
                                        </Show>
                                        <Show
                                          when={
                                            !message.deleted && message.replyTo
                                          }
                                        >
                                          {(id) => (
                                            <button
                                              type="button"
                                              class="mb-1 block max-w-full truncate border-l-2 border-accent py-0.5 pl-3 text-left text-xs text-ink-muted"
                                              onClick={() =>
                                                fireAndForget(
                                                  openQuoted(id()),
                                                  'external-chat.quote'
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
                                                      message={messageData(
                                                        reply()
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
                                        <Show
                                          when={
                                            !message.deleted && message.rich
                                          }
                                        >
                                          {(rich) => <RichCard rich={rich()} />}
                                        </Show>
                                        <MessageMedia
                                          attachments={message.attachments}
                                          sent={conversation.sentFiles(
                                            message.id
                                          )}
                                        />
                                        <Show when={placeholders().length > 0}>
                                          <div class="mt-1 flex flex-wrap gap-2">
                                            <For each={placeholders()}>
                                              {(attachment) => (
                                                <AttachmentChip
                                                  attachment={attachment}
                                                  url={source.fileUrl}
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
                      </div>
                    </div>
                    <CustomScrollbar
                      scrollContainer={scrollerElement}
                      watchContent
                      onScrollIntent={intent}
                    />
                  </div>
                </MaybeMessageActionDrawerManager>
              </StaticMarkdownContext>
              <Show when={source.chat.data}>
                {(group) => (
                  <FloatRegionOrInline region="accessory">
                    <Show
                      when={group().canSend && !stopped()}
                      fallback={
                        <ChannelInputContainer>
                          <div class="macro-message-width flex shrink-0 flex-wrap items-center gap-2 border-t border-edge-muted px-4 pt-3 text-sm text-ink-muted touch:rounded-2xl touch:border-0 touch:island touch:px-3 touch:py-2">
                            <span role="status">
                              {stopped()
                                ? 'This chat is no longer syncing'
                                : composerNote(
                                    group(),
                                    getDisplayName(
                                      tryMacroId(group().ownerId)
                                    ) || undefined
                                  )}
                            </span>
                            <Show
                              when={
                                group().sendReason === 'no_account' ||
                                group().sendReason === 'disconnected'
                              }
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={props.onConnect}
                              >
                                Connect {provider()?.label}
                              </Button>
                            </Show>
                          </div>
                        </ChannelInputContainer>
                      }
                    >
                      <ChannelInputContainer>
                        <div
                          data-keep-keyboard
                          class="relative flex w-full flex-col items-center gap-1"
                        >
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
                                        message={messageData(target().message)}
                                      />
                                    </>
                                  )
                                }
                                onActivate={() =>
                                  fireAndForget(
                                    openQuoted(target().message.id),
                                    'external-chat.quote'
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
                              id: `external-chat-input-${group().id}`,
                              placeholder: composerPlaceholder(group()),
                            }}
                            features={
                              chatProvider(group().provider).composerFeatures
                            }
                            participants={() => mentionable(group())}
                            fileAccept={group().limits.attachmentTypes.join(
                              ','
                            )}
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
                                  : `Couldn't send to ${provider()?.label}. Try again.`
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
            </div>
          </div>
        </SidePanel.Layout>
      </div>
      <ConfirmDialog
        open={!!deleting()}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete this message for everyone?"
        body={`This also deletes the message in ${provider()?.label}.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          const id = deleting();
          setDeleting(undefined);
          if (id) await conversation.remove(id);
        }}
      />
    </div>
  );
}
