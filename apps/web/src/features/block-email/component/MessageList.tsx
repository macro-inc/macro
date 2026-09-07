import { useEmailContext } from '@block-email/component/EmailContext';
import { isScrollingToMessage } from '@block-email/signal/scrollState';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Key } from '@solid-primitives/keyed';
import { Button, cn, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  onCleanup,
  Show,
} from 'solid-js';
import {
  fetchOlderMessages,
  isTruncatedMiddleMessage,
  isUnreadMessage,
  listNeedsOlderPage,
  threadMessageIsExpanded,
  truncatedMiddleCount,
} from '../util/scrollToMessage';
import { EmailParticipants } from './EmailParticipants';
import { EmailThreadTitle } from './EmailThreadTitle';
import { MessageContainer } from './MessageContainer';

interface MessageListProps {
  initialLoadComplete: boolean;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  title?: string;
  /**
   * Full-frame mobile: when nothing is in flow below the list (the collapsed
   * reply buttons float in the accessory region), the list carries the bottom
   * inset in-scroll so the last message rests above the floating chrome.
   */
  underScrollsBottom?: boolean;
  showMiddleMessages: boolean;
  hiddenChipFocused: boolean;
  allowRowHover: boolean;
  onHiddenChipFocus: () => void;
  onOpenMiddle: () => void;
}

export function MessageList(props: MessageListProps) {
  const getIsScrollingToMessage = isScrollingToMessage.get;
  const context = useEmailContext();
  // One selected message at a time, whether it was reached by click, tab, or
  // arrow keys — they all write the same focused id.
  const isSelectedSelector = createSelector(
    context.messages.focusedID,
    (a, b) => !!a && !!b && a === b
  );
  const hiddenCount = createMemo(() =>
    truncatedMiddleCount(context.messages.list().length)
  );
  createEffect(() => {
    const list = context.messagesListRef();
    if (!list) return;

    const applyHeight = () => {
      list.style.setProperty('--thread-height', `${list.clientHeight}px`);
    };

    const maybeFetchOlder = () => {
      if (
        !listNeedsOlderPage({
          initialLoadComplete: props.initialLoadComplete,
          isScrollingToMessage: getIsScrollingToMessage(),
          isFetching: context.query.isFetching(),
          hasMore: context.query.hasMore(),
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
        })
      ) {
        return;
      }
      void fetchOlderMessages(list, context.query.fetchNextPage);
    };

    applyHeight();
    maybeFetchOlder();
    const observer = new ResizeObserver(() => {
      applyHeight();
      maybeFetchOlder();
    });
    observer.observe(list);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      class={cn(
        'pt-1 pb-6 w-full flex flex-col items-center gap-2 overflow-y-scroll overflow-x-hidden [overflow-anchor:none] scrollbar-hidden text-sm scroll-pt-4 scroll-pb-4 scroll-smooth motion-reduce:scroll-auto',
        'touch:pt-[calc(var(--mobile-content-inset-top,0)+0.5rem)]',
        props.underScrollsBottom &&
          'touch:pb-[calc(var(--mobile-content-inset-bottom,0)+1.5rem)]'
      )}
      ref={context.registerMessagesList}
      onscroll={(e) => {
        const list = e.currentTarget;
        const scrollFromTop = list.scrollTop;

        if (getIsScrollingToMessage() || !props.initialLoadComplete) return;

        const isNearBeginning = scrollFromTop <= 300;

        if (
          isNearBeginning &&
          !context.query.isFetching() &&
          context.query.hasMore()
        ) {
          void fetchOlderMessages(list, context.query.fetchNextPage);
        }
      }}
    >
      <Show when={props.title}>
        <div class="shrink-0 w-full flex justify-center">
          <div
            class={cn(
              'macro-message-width macro-message-padding w-full',
              isTouchDevice() ? 'pt-6 pb-3' : 'pt-12 pb-2.5'
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
      <Layer depth={1}>
        <StaticMarkdownContext>
          {/* Key by db_id so prepends and refetches keep per-row state. */}
          <Key each={context.messages.list()} by="db_id">
            {(message) => {
              const chronologicalIndex = createMemo(() =>
                context.messages
                  .list()
                  .findIndex((item) => item.db_id === message().db_id)
              );
              const normalizedIndex = createMemo(() => {
                // The element at the 0th index isn't actually the first message
                // if there is more data to load so we return -1 so that `isFirstMessage`
                // evaluates to false. This fixes an issue with the "first" message' full
                // html to show in `EmailMessageBody`
                if (chronologicalIndex() === 0 && context.query.hasMore()) {
                  return -1;
                }

                return chronologicalIndex();
              });

              const isLastMessage = createMemo(() => {
                return (
                  chronologicalIndex() ===
                  (context.messages.list().length ?? 0) - 1
                );
              });
              const hideMiddle = createMemo(() => {
                return (
                  !props.showMiddleMessages &&
                  isTruncatedMiddleMessage(
                    chronologicalIndex(),
                    context.messages.list().length
                  )
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
                  chronologicalIndex: chronologicalIndex(),
                  listLength: context.messages.list().length,
                  expansionOverride:
                    context.messages.expandedBodyIds[messageID],
                  isUnread: isUnreadMessage(message()),
                  hasDraft: hasDraft(),
                });
              });

              return (
                <>
                  <Show when={!hideMiddle()}>
                    <MessageContainer
                      isFirstMessage={normalizedIndex() === 0}
                      isLastMessage={isLastMessage()}
                      isSelected={isSelectedSelector(
                        message().db_id ?? undefined
                      )}
                      allowHover={props.allowRowHover}
                      message={message()}
                      isExpanded={isExpanded()}
                      markdownDomRef={
                        isLastMessage() ? props.markdownDomRef : undefined
                      }
                    />
                  </Show>
                  <Show
                    when={
                      chronologicalIndex() === 0 &&
                      !props.showMiddleMessages &&
                      hiddenCount() > 0
                    }
                  >
                    <div class="shrink-0 w-full flex justify-center">
                      <div class="macro-message-width macro-message-padding w-full">
                        <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                          <span
                            aria-hidden="true"
                            class="border-t border-edge-muted"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            class={cn(
                              props.hiddenChipFocused && 'bg-active text-ink'
                            )}
                            data-hidden-messages
                            onPointerEnter={() =>
                              context.messages.setHovered({
                                kind: 'hidden-chip',
                              })
                            }
                            onPointerLeave={() => {
                              if (
                                context.messages.hovered()?.kind ===
                                'hidden-chip'
                              ) {
                                context.messages.setHovered(undefined);
                              }
                            }}
                            onFocus={() => props.onHiddenChipFocus()}
                            onClick={() => props.onOpenMiddle()}
                          >
                            Show {hiddenCount()} hidden{' '}
                            {hiddenCount() === 1 ? 'message' : 'messages'}
                          </Button>
                          <span
                            aria-hidden="true"
                            class="border-t border-edge-muted"
                          />
                        </div>
                      </div>
                    </div>
                  </Show>
                </>
              );
            }}
          </Key>
        </StaticMarkdownContext>
      </Layer>
    </div>
  );
}
