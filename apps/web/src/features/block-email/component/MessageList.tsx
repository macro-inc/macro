import { useEmailContext } from '@block-email/component/EmailContext';
import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretUpDownIcon from '@phosphor-icons/core/regular/caret-up-down.svg?component-solid';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  Index,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import {
  collapsedRowShowsDivider,
  isTruncatedMiddleMessage,
  isUnreadMessage,
  nextShownChronologicalIndex,
  shownOpenCardFlush,
  threadMessageIsExpanded,
  truncatedMiddleCount,
} from '../util/scrollToMessage';
import { EmailParticipants } from './EmailParticipants';
import { EmailThreadTitle } from './EmailThreadTitle';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  onScrollPositionChange?: (scrollFromTop: number) => void;
  title?: string;
  /**
   * Full-frame mobile: when nothing is in flow below the list (the collapsed
   * reply buttons float in the accessory region), the list carries the bottom
   * inset in-scroll so the last message rests above the floating chrome.
   */
  underScrollsBottom?: boolean;
}

export function MessageList(props: MessageListProps) {
  const getIsScrollingToMessage = isScrollingToMessage.get;
  const context = useEmailContext();
  const isFocusedSelector = createSelector(
    context.messages.focusedID,
    (a, b) => !!a && !!b && a === b
  );
  const isTargetSelector = createSelector(
    context.messages.targetMessageID,
    (a, b) => a === b
  );
  const [showMiddleMessages, setShowMiddleMessages] = createSignal(false);

  createEffect(
    on(
      () => context.thread()?.db_id,
      () => setShowMiddleMessages(false)
    )
  );

  createEffect(() => {
    const messages = context.messages.list();
    const ids = [
      context.messages.targetMessageID(),
      context.messages.focusedID(),
    ];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const chronologicalIndex = messages.findIndex(
        (message) => message.db_id === id
      );
      if (isTruncatedMiddleMessage(chronologicalIndex, messages.length)) {
        setShowMiddleMessages(true);
        return;
      }
    }
  });

  createEffect(() => {
    const list = context.messagesListRef();
    if (!list) return;

    const applyHeight = () => {
      list.style.setProperty('--thread-height', `${list.clientHeight}px`);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(list);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      class={cn(
        'pt-1 pb-6 w-full flex flex-col items-center overflow-y-scroll overflow-x-hidden scrollbar-hidden text-sm',
        'touch:pt-[calc(var(--mobile-content-inset-top,0)+0.5rem)]',
        props.underScrollsBottom &&
          'touch:pb-[calc(var(--mobile-content-inset-bottom,0)+1.5rem)]'
      )}
      ref={context.registerMessagesList}
      onscroll={(e) => {
        const scrollFromTop = e.currentTarget.scrollTop;
        props.onScrollPositionChange?.(scrollFromTop);

        if (getIsScrollingToMessage() || !props.initialLoadComplete) return;

        if (
          scrollFromTop <= 300 &&
          !context.query.isFetching() &&
          context.query.hasMore()
        ) {
          context.query.fetchNextPage();
        }
      }}
    >
      <Show when={props.title}>
        <div class="shrink-0 w-full flex justify-center">
          <div
            class={cn(
              'macro-message-width macro-message-padding w-full',
              isTouchDevice()
                ? 'pt-6 pb-3'
                : 'border-b border-edge-muted/50 pt-12 pb-2.5'
            )}
          >
            <EmailThreadTitle
              title={props.title ?? ''}
              copyReveal={isTouchDevice() ? 'always' : 'hover'}
              class={isTouchDevice() ? 'text-xl pt-1 pb-0' : 'text-2xl pb-1.5'}
            />
            <Show when={!isTouchDevice()}>
              <EmailParticipants />
            </Show>
          </div>
        </div>
      </Show>
      <StaticMarkdownContext>
        {/* We use Index because the index of the messages should always be stable and
          only the value changes. This also helps prevent nested inputs from rerendering
        */}
        <Index each={context.messages.list()}>
          {(message, index) => {
            const normalizedIndex = createMemo(() => {
              // The element at the 0th index isn't actually the first message
              // if there is more data to load so we return -1 so that `isFirstMessage`
              // evaluates to false. This fixes an issue with the "first" message' full
              // html to show in `EmailMessageBody`
              if (index === 0 && context.query.hasMore()) {
                return -1;
              }

              return index;
            });

            const isLastMessage = createMemo(() => {
              return index === (context.messages.list().length ?? 0) - 1;
            });
            const hideMiddle = createMemo(() => {
              return (
                !showMiddleMessages() &&
                isTruncatedMiddleMessage(
                  index,
                  context.messages.list().length
                )
              );
            });

            const isNewMessage = createMemo(() => {
              return (
                message().labels.find(
                  (l) => l.provider_label_id === 'UNREAD'
                ) !== undefined
              );
            });

            // A message with an in-progress draft reply stays expanded so the
            // draft remains visible even after newer messages arrive (matches
            // Gmail/Superhuman). Desktop only: mobile edits drafts in a drawer.
            const hasDraft = createMemo(() => {
              const messageID = message().db_id;
              if (!messageID || isTouchDevice()) return false;
              return !!context.drafts.getDraftForMessage(messageID);
            });

            const isExpanded = createMemo(() => {
              const messageID = message().db_id;
              if (!messageID) return false;
              return threadMessageIsExpanded({
                chronologicalIndex: index,
                listLength: context.messages.list().length,
                expansionOverride: context.messages.expandedBodyIds[messageID],
                isUnread: isNewMessage(),
                hasDraft: hasDraft(),
              });
            });

            const cardFlush = createMemo(() => {
              const list = context.messages.list();
              return shownOpenCardFlush(
                index,
                list.length,
                showMiddleMessages(),
                (neighborIndex) => {
                  const neighbor = list[neighborIndex];
                  const neighborId = neighbor?.db_id;
                  if (!neighbor || !neighborId) return false;
                  return threadMessageIsExpanded({
                    chronologicalIndex: neighborIndex,
                    listLength: list.length,
                    expansionOverride:
                      context.messages.expandedBodyIds[neighborId],
                    isUnread: isUnreadMessage(neighbor),
                    hasDraft:
                      !isTouchDevice() &&
                      !!context.drafts.getDraftForMessage(neighborId),
                  });
                }
              );
            });

            const showBottomBorder = createMemo(() => {
              if (isExpanded()) return false;
              const list = context.messages.list();
              const nextIndex = nextShownChronologicalIndex(
                index,
                list.length,
                showMiddleMessages()
              );
              const next = nextIndex != null ? list[nextIndex] : undefined;
              const nextId = next?.db_id;
              const nextIsCollapsed =
                nextIndex != null &&
                !!next &&
                !!nextId &&
                !threadMessageIsExpanded({
                  chronologicalIndex: nextIndex,
                  listLength: list.length,
                  expansionOverride: context.messages.expandedBodyIds[nextId],
                  isUnread: isUnreadMessage(next),
                  hasDraft:
                    !isTouchDevice() &&
                    !!context.drafts.getDraftForMessage(nextId),
                });
              return collapsedRowShowsDivider(
                index,
                list.length,
                showMiddleMessages(),
                nextIsCollapsed
              );
            });

            return (
              <>
                <Show when={!hideMiddle()}>
                  <MessageContainer
                    isFirstMessage={normalizedIndex() === 0}
                    isLastMessage={isLastMessage()}
                    isFocused={isFocusedSelector(message().db_id ?? undefined)}
                    isTarget={isTargetSelector(message().db_id ?? undefined)}
                    message={message()}
                    isExpanded={isExpanded()}
                    flushTop={cardFlush().top}
                    flushBottom={cardFlush().bottom}
                    showBottomBorder={showBottomBorder()}
                    markdownDomRef={
                      isLastMessage() ? props.markdownDomRef : undefined
                    }
                  />
                </Show>
                <Show
                  when={
                    index === 0 &&
                    !showMiddleMessages() &&
                    truncatedMiddleCount(context.messages.list().length) > 0
                  }
                >
                  <div class="shrink-0 w-full flex justify-center">
                    <div class="macro-message-width macro-message-padding w-full">
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        class="group justify-start gap-0 px-0 font-semibold macro-thread-avatar-axis"
                        label={`Show ${truncatedMiddleCount(context.messages.list().length)} hidden messages`}
                        onClick={() => setShowMiddleMessages(true)}
                      >
                        <span class="relative shrink-0 size-6 flex items-center justify-center border border-edge-muted bg-panel text-xs font-semibold text-ink rounded-sm">
                          <span class="group-hover:invisible">
                            {truncatedMiddleCount(
                              context.messages.list().length
                            )}
                          </span>
                          <CaretUpDownIcon class="absolute inset-0 m-auto size-3 opacity-0 group-hover:opacity-100" />
                        </span>
                        <div
                          aria-hidden="true"
                          class="h-1.5 min-w-0 flex-1 border-y border-edge-muted bg-ink-muted/4"
                        />
                      </Button>
                    </div>
                  </div>
                </Show>
              </>
            );
          }}
        </Index>
      </StaticMarkdownContext>
    </div>
  );
}
