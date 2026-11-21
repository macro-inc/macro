import { t } from '@app/lib/i18n';
import {
  ChannelInput,
  type InputHandle,
  type InputSnapshot,
} from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { useMessageBotMentionUsers } from '@channel/use-channel-bot-mention-users';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import { useMessageLink } from '@queries/messages/document-messages';
import {
  newMessageId,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import { useMessageTimelineQuery } from '@queries/messages/timeline';
import { timelineMessages } from '@queries/messages/timeline-entries';
import type {
  MessageListItem,
  MessageParent,
  MessageTimelinePage,
} from '@service-storage/messages';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { MessageLoadError } from './MessageLoadError';
import { MessageThread } from './MessageThread';
import type { MessageData } from './types';

/** The root composer, inline below the roots or floating on touch devices. */
export function EntityConversationComposer(props: {
  parent: MessageParent;
  collapsible?: boolean;
  /** Dismiss the keyboard after submitting from a floating mobile composer. */
  blurOnSend?: boolean;
  onReady?: (handle: InputHandle) => void;
  onSent?: () => void;
  onChange?: (snapshot: InputSnapshot) => void;
}) {
  const parentKey = () => `${props.parent.type}:${props.parent.id}`;
  const send = useSendMessageMutation();
  const userId = useUserId();
  const [writing, setWriting] = createSignal(false);
  const bots = useMessageBotMentionUsers(() => props.parent, writing);
  return (
    <div
      class="contents"
      onPointerEnter={() => setWriting(true)}
      onFocusIn={() => setWriting(true)}
    >
      <ChannelInput
        parent={props.parent}
        bots={bots}
        input={{ mode: 'channel', placeholder: t('common.addToDiscussion') }}
        autofocus={false}
        collapsible={props.collapsible}
        onChange={props.onChange}
        onReady={props.onReady}
        onSend={async (snapshot) => {
          const senderId = userId();
          if (!senderId) return;
          const sendingParent = parentKey();
          await send.mutateAsync({
            parent: props.parent,
            senderId,
            optimisticId: newMessageId(),
            ...buildPostMessageSendPayload({ snapshot }),
          });
          if (parentKey() !== sendingParent) return;
          // ChannelInput clears optimistically and restores failures itself.
          // Clearing again here would discard text typed during delivery.
          props.onSent?.();
          if (props.blurOnSend && document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        }}
      />
    </div>
  );
}

export type EntityConversationProps = {
  parent: MessageParent;
  canWrite: boolean;
  /** Delete comments the caller did not write. Document owners set this. */
  canModerate?: boolean;
  targetId?: string | null;
  /** Re-aim the same linked comment without remounting the conversation. */
  targetRequestKey?: string | number;
  /** The linked view stays around `targetId`, but its message is no longer highlighted. */
  targetCleared?: boolean;
  onClearTarget?: () => void;
  buildLink?: (message: MessageData) => string;
  label?: string;
  /** The composer is rendered elsewhere, such as a floating mobile accessory. */
  hideComposer?: boolean;
  /** Render nothing while there is no root to show. */
  hideWhenEmpty?: boolean;
  children?: (conversation: ConversationPresentation) => JSX.Element;
};

export type ConversationPresentation = {
  messages: Accessor<MessageListItem[]>;
  targetId: Accessor<string | null | undefined>;
  targetRequestKey: Accessor<string | number | undefined>;
  pending: Accessor<boolean>;
  unavailable: Accessor<boolean>;
  failed: Accessor<boolean>;
  retry(): void;
  content: () => JSX.Element;
};

function conversationRoots(pages: MessageTimelinePage[] | undefined) {
  return (
    pages
      ?.flatMap(timelineMessages)
      .filter(
        (message) => !message.state.deleted_at && message.state.anchor === null
      )
      .toReversed() ?? []
  );
}
export function EntityConversation(props: EntityConversationProps) {
  const [expanded, setExpanded] = createSignal(true);
  const target = useMessageLink(
    () => props.parent,
    () => props.targetId
  );
  // A copied link may name a reply or an anchored root; the window is a root window.
  const query = useMessageTimelineQuery(
    () => props.parent,
    target.rootId,
    target.resolved
  );
  const unavailable = () =>
    ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some(
      (code) =>
        thrownResultErrorHasCode(query.error, code) ||
        (code !== 'NOT_FOUND' && thrownResultErrorHasCode(target.error(), code))
    );
  const missingParent = () =>
    thrownResultErrorHasCode(query.error, 'NOT_FOUND');
  // Until the link resolves, the shared latest page would flash before the window jumps.
  const messages = () =>
    target.resolved() && !query.isPending && !unavailable()
      ? conversationRoots(query.data?.pages)
      : [];
  const messagesById = createMemo(
    () => new Map(messages().map((message) => [message.id, message]))
  );
  const content = () => (
    <StaticMarkdownContext>
      <Show when={!target.resolved() || query.isPending}>
        <p class="text-xs text-ink-muted">{t('common.loadingConversation')}</p>
      </Show>
      <Show when={query.isError || unavailable()}>
        <MessageLoadError
          retrying={query.isFetching}
          onRetry={
            missingParent()
              ? undefined
              : () => {
                  fireAndForget(query.refetch(), 'entity-conversation');
                  if (props.targetId)
                    fireAndForget(target.refetch(), 'entity-conversation');
                }
          }
        >
          <Show
            when={missingParent()}
            fallback={t('common.discussionLoadError')}
          >
            {t('common.discussionUnavailable')}
          </Show>
        </MessageLoadError>
      </Show>
      <Show when={!unavailable() && query.hasNextPage}>
        <button
          class="text-xs"
          disabled={query.isFetching}
          onClick={() =>
            fireAndForget(query.fetchNextPage(), 'entity-conversation')
          }
        >
          {t('common.loadEarlierMessages')}
        </button>
      </Show>
      <For each={[...messagesById().keys()]}>
        {(id) => (
          <MessageThread
            data={messagesById().get(id)!}
            canWrite={props.canWrite}
            canModerate={props.canModerate}
            targetRequestKey={props.targetRequestKey}
            targetId={
              target.rootId() === id && !props.targetCleared
                ? target.messageId()
                : null
            }
            onClearTarget={props.onClearTarget}
            buildLink={props.buildLink}
          />
        )}
      </For>
      <Show when={!unavailable() && query.hasPreviousPage}>
        <button
          class="text-xs"
          disabled={query.isFetching}
          onClick={() =>
            fireAndForget(query.fetchPreviousPage(), 'entity-conversation')
          }
        >
          {t('common.loadNewerMessages')}
        </button>
      </Show>
    </StaticMarkdownContext>
  );
  return (
    <Show
      when={props.children}
      fallback={
        <Show
          when={
            !props.hideWhenEmpty ||
            messages().length > 0 ||
            query.isError ||
            unavailable()
          }
        >
          <section class="mt-3 pb-12" data-entity-conversation>
            <button
              type="button"
              class="flex items-center gap-1"
              onClick={() => setExpanded(!expanded())}
            >
              <Show when={expanded()} fallback={<CaretRight class="size-3" />}>
                <CaretDown class="size-3" />
              </Show>
              <span class="text-xs">
                {props.label ?? t('common.discussion')}
              </span>
            </button>
            <Show when={expanded() || props.targetId}>
              {content()}
              <Show
                when={props.canWrite && !props.hideComposer && !unavailable()}
              >
                <div class="mt-4">
                  <EntityConversationComposer parent={props.parent} />
                </div>
              </Show>
            </Show>
          </section>
        </Show>
      }
    >
      {(render) => {
        // A phone entry stays on the latest root while its sheet follows an
        // older link. Ordinary inline conversations need no second observer.
        const separatePreview = () => Boolean(props.targetId);
        const latest = useMessageTimelineQuery(
          () => props.parent,
          () => null,
          separatePreview
        );
        const previewQuery = () => (separatePreview() ? latest : query);
        const previewUnavailable = () =>
          unavailable() ||
          ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'].some((code) =>
            thrownResultErrorHasCode(previewQuery().error, code)
          );
        return render()({
          messages: () =>
            !previewQuery().isPending && !previewUnavailable()
              ? conversationRoots(previewQuery().data?.pages)
              : [],
          targetId: () => props.targetId,
          targetRequestKey: () => props.targetRequestKey,
          pending: () => previewQuery().isPending,
          unavailable: previewUnavailable,
          failed: () => previewQuery().isError,
          retry: () => {
            fireAndForget(previewQuery().refetch(), 'entity-conversation');
          },
          content: () => <Show when={!previewUnavailable()}>{content()}</Show>,
        });
      }}
    </Show>
  );
}
