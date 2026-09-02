import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { EmailCompose } from '@block-email/component/compose/Compose';
import {
  EmailProvider,
  useEmailContext,
} from '@block-email/component/EmailContext';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  useCanAutofocusSplitContent,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { useEmail, useUserContext } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { AnimatedTaskIcon } from '@icon/wide-task';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { isScrollingToMessage } from '../signal/scrollState';
import { registerEmailHotkeys } from '../util/emailHotkeys';
import { isPersonalMessage } from '../util/isPersonalMessage';
import type { ReplyType } from '../util/replyType';
import {
  hiddenMessagesControl,
  isTruncatedMiddleMessage,
  isUnreadMessage,
  keyboardRevealDelta,
  leadingThrottle,
  listScrollBehavior,
  messageElement,
  nearestDelta,
  pageThenAdvanceDelta,
  revealMessageAfterLayout,
  type ScrollAlign,
  scrollToListEndDelta,
  scrollToListStartDelta,
  scrollToMessage,
  threadMessageIsExpanded,
} from '../util/scrollToMessage';
import {
  adjacentStop,
  nextThreadStop,
  shownStops,
  type ThreadStop,
  threadStopFromHover,
} from '../util/threadStops';
import { BottomReplyButtons } from './BottomReplyButtons';
import { EmailFormContextProvider } from './EmailFormContext';
import { openEmailReplyComposerForMessage } from './emailReplyActions';
import { MessageList } from './MessageList';
import { MobileEmailComposeDrawer } from './MobileEmailComposeDrawer';
import { ModalsProvider } from './ModalsProvider';
import { EmailSidePanelSections } from './sidepanel/EmailSidePanelSections';
import { TopBar } from './TopBar';

const TARGET_MESSAGE_HIGHLIGHT_MS = 800;
/** List navigation — keep within the 300ms UI motion budget (improve-animations). */
const SCROLL_ANIMATION_MS = 250;
const KEYBOARD_SCROLL_MS = 250;

type EmailViewProps = {
  title: string;
  threadId: Accessor<string>;
};

export function EmailView(props: EmailViewProps) {
  return (
    <EmailProvider threadID={props.threadId()}>
      <SidePanel.Layout>
        <EmailContent {...props} />
        <EmailSidePanelSections
          threadId={props.threadId()}
          title={props.title}
        />
      </SidePanel.Layout>
    </EmailProvider>
  );
}

function EmailContent(props: EmailViewProps) {
  const scopeId = blockHotkeyScopeSignal.get;
  const { popoverSplit } = useSplitLayout();

  const setIsScrollingToMessage = isScrollingToMessage.set;
  const blockElement = blockElementSignal.get;

  const context = useEmailContext();
  const splitPanel = useSplitPanel();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const { isLoading: isUserLoading } = useUserContext();
  const userEmail = useEmail();

  const openTaskCompose = () => {
    const threadId = context.thread()?.db_id;
    if (!threadId) return;
    const title =
      props.title.length > 70 ? `${props.title.slice(0, 70)}...` : props.title;
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        initialTitle: title,
        initialContent: buildMentionMarkdownString({
          type: 'document',
          documentId: threadId,
          documentName: props.title,
          blockName: 'email',
        }),
      },
    });
  };

  /**
   * Waits for the query to finish fetching
   */
  const waitForQueryLoad = (): Promise<void> => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!context.query.isFetching()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  };

  /**
   * Loads messages until the target message is found or no more messages available
   */
  const loadMessagesUntilFound = async (
    targetMessageId: string
  ): Promise<boolean> => {
    while (true) {
      const messages = context.messages.unfiltered();

      // Check if message exists in current batch
      const messageExists = messages.some(
        (m: ApiMessage) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!context.query.hasMore()) return false;

      // Load next batch and wait
      context.query.fetchNextPage();
      await waitForQueryLoad();
    }
  };

  const fetchNextPage = async () => {
    if (context.query.hasMore() && !context.query.isFetching()) {
      context.query.fetchNextPage();
      await waitForQueryLoad();
    }
  };

  const canRunInitialEmailScroll = () =>
    !isTouchDevice() || splitPanel?.isPanelActive() !== false;

  const [keyboardSelecting, setKeyboardSelecting] = createSignal(false);
  const [listAnchor, setListAnchor] = createSignal<'title' | 'composer'>();
  let lastPointer = { x: Number.NaN, y: Number.NaN };
  let armedPointer: { x: number; y: number } | undefined;

  // Hand list navigation back to the pointer: arrow keys resume from whatever
  // the mouse is over. The selection itself survives, so a message reached with
  // the keyboard stays selected once the mouse moves.
  const releaseKeyboardPointer = () => {
    armedPointer = undefined;
    setKeyboardSelecting(false);
    setListAnchor(undefined);
    leaveHiddenChip();
  };

  /** Escape drops the selection too, not just the keyboard's claim on it. */
  const clearSelection = () => {
    releaseKeyboardPointer();
    context.messages.setFocused(undefined);
  };

  const armKeyboardPointer = () => {
    if (isTouchDevice()) return;
    setKeyboardSelecting(true);
    armedPointer = { x: lastPointer.x, y: lastPointer.y };
  };

  const leaveHiddenChip = () => {
    context.messages.setHiddenChipFocused(false);
    const list = untrack(context.messagesListRef);
    const button = list ? hiddenMessagesControl(list) : undefined;
    if (button && document.activeElement === button) {
      button.blur();
      blockElement()?.focus({ preventScroll: true });
    }
  };

  /**
   * Performs scrolling to a message and updates focus.
   */
  const performScrollToMessage = (
    messageId: string,
    opts: {
      behavior?: ScrollBehavior;
      focus?: boolean;
      align?: ScrollAlign;
    } = {
      behavior: 'smooth',
      focus: true,
    }
  ) => {
    opts = { focus: true, behavior: 'smooth', align: 'nearest', ...opts };
    const messages = untrack(context.messages.list);
    const container = untrack(context.messagesListRef);

    if (!messages || !container) return false;

    setIsScrollingToMessage(true);

    const success = scrollToMessage(messageId, messages, container, {
      behavior: opts.behavior,
      align: opts.align,
    });

    if (!success) {
      setIsScrollingToMessage(false);
      return false;
    }

    if (opts.focus) {
      leaveHiddenChip();
      context.messages.setFocused(messageId);
    }

    if (context.messages.targetMessageID() === messageId) {
      setTimeout(() => {
        context.messages.setTargetMessageID(undefined);
      }, TARGET_MESSAGE_HIGHLIGHT_MS);
    }

    setTimeout(() => setIsScrollingToMessage(false), SCROLL_ANIMATION_MS);

    return true;
  };

  context.onInitialDataLoad(() => {
    if (!canRunInitialEmailScroll()) return false;
    if (!untrack(context.messagesListRef)) return false;

    const targetMessageId_ = context.messages.targetMessageID();
    if (targetMessageId_ && typeof targetMessageId_ !== 'string') return true;
    if (typeof targetMessageId_ === 'string') {
      void revealTargetMessage(targetMessageId_);
    }

    return true;
  });

  async function revealTargetMessage(messageId: string) {
    context.messages.setExpandedBodyId(messageId, true);
    const messages = untrack(context.messages.list);
    if (!messages) return;

    const initialIndex = messages.findIndex(
      (message) => message.db_id === messageId
    );

    if (initialIndex < 0) {
      try {
        const found = await loadMessagesUntilFound(messageId);
        if (!found) return;
        await fetchNextPage();
      } catch (error) {
        console.error('Error loading target message:', error);
        return;
      }
    } else if (initialIndex === 0) {
      await fetchNextPage();
    }

    requestAnimationFrame(() => {
      performScrollToMessage(messageId, {
        behavior: 'instant',
        focus: true,
        align: 'start',
      });
    });
  }

  const [userOpenedMiddle, setUserOpenedMiddle] = createSignal(false);
  createEffect(
    on(
      () => context.thread()?.db_id,
      () => {
        setUserOpenedMiddle(false);
        leaveHiddenChip();
      }
    )
  );

  const showMiddleMessages = createMemo(() => {
    if (userOpenedMiddle()) return true;
    const messages = context.messages.list();
    const focus = context.messages.focusedID();
    const target = context.messages.targetMessageID();
    for (let i = 0; i < messages.length; i++) {
      if (!isTruncatedMiddleMessage(i, messages.length)) continue;
      const id = messages[i]?.db_id;
      if (id && (id === focus || id === target)) return true;
      if (isUnreadMessage(messages[i])) return true;
      if (!isTouchDevice() && id && context.drafts.getDraftForMessage(id))
        return true;
    }
    return false;
  });

  let markdownDomRef!: HTMLDivElement;
  const tryKeyboardListScroll = leadingThrottle(KEYBOARD_SCROLL_MS);

  const scrollListBy = (
    list: HTMLElement,
    top: number,
    animationMs = SCROLL_ANIMATION_MS
  ) => {
    if (top === 0) return false;
    setIsScrollingToMessage(true);
    setTimeout(() => setIsScrollingToMessage(false), animationMs);
    list.scrollBy({ top, behavior: listScrollBehavior() });
    return true;
  };

  const keyboardScrollListBy = (list: HTMLElement, top: number) => {
    if (top === 0) return false;
    if (!tryKeyboardListScroll()) return true;
    setIsScrollingToMessage(true);
    setTimeout(() => setIsScrollingToMessage(false), KEYBOARD_SCROLL_MS);
    list.scrollBy({ top, behavior: listScrollBehavior() });
    return true;
  };

  const focusHiddenMessages = () => {
    const list = untrack(context.messagesListRef);
    if (!list) return false;
    const button = hiddenMessagesControl(list);
    if (!button) return false;
    context.messages.setFocused(undefined);
    context.messages.setHiddenChipFocused(true);
    scrollListBy(list, nearestDelta(list, button));
    return true;
  };

  const applyStop = (
    stop: ThreadStop | undefined,
    messages: ApiMessage[],
    list: HTMLElement
  ) => {
    if (!stop) return true;
    return match(stop)
      .with({ kind: 'title' }, () => {
        armKeyboardPointer();
        setListAnchor('title');
        context.messages.setFocused(undefined);
        const startDelta = scrollToListStartDelta(list);
        if (startDelta !== 0) return scrollListBy(list, startDelta);
        return true;
      })
      .with({ kind: 'hidden-chip' }, () => {
        armKeyboardPointer();
        setListAnchor(undefined);
        return focusHiddenMessages();
      })
      .with({ kind: 'message' }, ({ index }) => {
        const id = messages[index]?.db_id;
        if (!id) return false;
        armKeyboardPointer();
        setListAnchor(undefined);
        return performScrollToMessage(id, {
          behavior: 'smooth',
          focus: true,
        });
      })
      .with({ kind: 'composer' }, () => {
        armKeyboardPointer();
        setListAnchor('composer');
        leaveHiddenChip();
        context.messages.setFocused(undefined);
        markdownDomRef.focus();
        return true;
      })
      .exhaustive();
  };

  const navigateMessage = createCallback((dir: 'prev' | 'next') => {
    const messages = context.messages.list();
    const list = context.messagesListRef();
    if (!messages?.length || !list) return false;

    const stops = shownStops({
      length: messages.length,
      showMiddle: showMiddleMessages(),
      hasComposer: Boolean(markdownDomRef),
    });

    const keyboard = (() => {
      if (!keyboardSelecting()) return undefined;
      if (context.messages.hiddenChipFocused())
        return { kind: 'hidden-chip' } as const;
      const anchor = listAnchor();
      if (anchor === 'title' || anchor === 'composer') {
        return { kind: anchor } as const;
      }
      const focusedId = context.messages.focusedID();
      if (!focusedId) return undefined;
      const index = messages.findIndex(
        (message) => message.db_id === focusedId
      );
      return index >= 0 ? ({ kind: 'message', index } as const) : undefined;
    })();

    if (keyboard?.kind === 'message') {
      const focusedId = messages[keyboard.index]?.db_id;
      const focusedEl = focusedId
        ? messageElement(list, messages, focusedId)
        : undefined;
      if (focusedEl) {
        const revealDelta = keyboardRevealDelta(list, focusedEl, dir);
        if (revealDelta !== 0) return keyboardScrollListBy(list, revealDelta);

        const pageDelta = pageThenAdvanceDelta(list, focusedEl, dir);
        if (pageDelta !== 0) return keyboardScrollListBy(list, pageDelta);
      }

      if (
        dir === 'next' &&
        keyboard.index === messages.length - 1 &&
        keyboardSelecting()
      ) {
        const nextStop = adjacentStop(stops, keyboard, 'next');
        if (!nextStop || nextStop.kind === 'composer') {
          const endDelta = scrollToListEndDelta(list);
          if (endDelta !== 0) return keyboardScrollListBy(list, endDelta);
          return true;
        }
      }
    }

    const messageIds = messages.map((message) => message.db_id);
    const hover = threadStopFromHover(context.messages.hovered(), messageIds);
    // The pointer leads while it is over the list. With the pointer elsewhere,
    // arrows step off the selected card rather than re-entering at the end.
    const selectedId = context.messages.focusedID();
    const selectedIndex = selectedId ? messageIds.indexOf(selectedId) : -1;
    const cursor =
      hover ??
      (selectedIndex >= 0
        ? ({ kind: 'message', index: selectedIndex } as const)
        : undefined);

    return applyStop(
      nextThreadStop({ stops, keyboard, hover: cursor, dir }),
      messages,
      list
    );
  });

  const navigateToPreviousMessage = () => navigateMessage('prev');
  const navigateToNextMessage = () => navigateMessage('next');

  // Wait for the block element before claiming focus on initial mount.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!canAutofocusSplitContent) return;
    // Focus the email block on mount
    if (isTouchDevice()) return;
    if (!blockElement()) return;
    blockElement()?.focus({ preventScroll: true });
    hasRun = true;
  });

  const getHotkeyTarget = () => {
    const messages = context.messages.list();
    if (messages.length === 0) return;

    const focusedId = context.messages.focusedID();
    const focusedMessage = focusedId
      ? messages.find((message) => message.db_id === focusedId)
      : undefined;
    const message = focusedMessage ?? messages.at(-1);
    if (!message?.db_id) return;

    return {
      message,
      isLastMessage: messages.at(-1)?.db_id === message.db_id,
    };
  };

  const isMessageRenderedExpanded = (
    target: NonNullable<ReturnType<typeof getHotkeyTarget>>
  ) => {
    const messageId = target.message.db_id;
    if (!messageId) return false;

    const list = context.messages.list();
    const chronologicalIndex = list.findIndex(
      (message) => message.db_id === messageId
    );
    if (chronologicalIndex < 0) return false;

    return threadMessageIsExpanded({
      chronologicalIndex,
      listLength: list.length,
      expansionOverride: context.messages.expandedBodyIds[messageId],
      isUnread: isUnreadMessage(target.message),
      hasDraft:
        !isTouchDevice() && !!context.drafts.getDraftForMessage(messageId),
    });
  };

  const openHotkeyTarget = (replyType: ReplyType) => {
    const target = getHotkeyTarget();
    if (!target) return false;

    return openEmailReplyComposerForMessage({
      ctx: context,
      message: target.message,
      replyType,
      isLastMessage: target.isLastMessage,
    });
  };

  onMount(() => {
    if (!isTouchDevice()) {
      const onMove = (event: PointerEvent) => {
        lastPointer = { x: event.clientX, y: event.clientY };
        const armed = armedPointer;
        if (!armed) return;
        if (event.clientX === armed.x && event.clientY === armed.y) return;
        releaseKeyboardPointer();
      };
      window.addEventListener('pointermove', onMove);
      onCleanup(() => window.removeEventListener('pointermove', onMove));
    }

    registerEmailHotkeys(scopeId(), {
      replyToFocusedMessage: () => openHotkeyTarget('reply-all'),
      forwardFocusedMessage: () => openHotkeyTarget('forward'),
      blockSender: context.blockSender,
      markDone: context.archiveThread,
      markNotDone: context.markThreadNotDone,
      isThreadDone: context.isThreadDone,
      canMarkNotDone: context.canMarkThreadNotDone,
      markUnread: context.markThreadUnread,
      markRead: context.markThreadRead,
      isThreadMarkedUnread: context.isThreadMarkedUnread,
      markSenderSignal: context.markSenderSignal,
      markSenderNoise: context.markSenderNoise,
      navigateToPreviousMessage,
      navigateToNextMessage,
    });
  });

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'enter',
    description: 'Reply to message',
    keyDownHandler: () => {
      if (context.messages.hiddenChipFocused()) {
        const messages = untrack(context.messages.list);
        const next = adjacentStop(
          shownStops({ length: messages.length, showMiddle: true }),
          { kind: 'message', index: 0 },
          'next'
        );
        const nextId =
          next?.kind === 'message' ? messages[next.index]?.db_id : undefined;
        setUserOpenedMiddle(true);
        if (!nextId) {
          leaveHiddenChip();
          return true;
        }
        context.messages.setFocused(nextId);
        revealMessageAfterLayout(
          nextId,
          messages,
          untrack(context.messagesListRef)
        );
        return true;
      }

      const focusedId = context.messages.focusedID();
      const target = getHotkeyTarget();

      if (focusedId && target?.message.db_id === focusedId) {
        if (!isMessageRenderedExpanded(target)) {
          context.messages.setExpandedBodyId(focusedId, true);
          revealMessageAfterLayout(
            focusedId,
            untrack(context.messages.list),
            untrack(context.messagesListRef)
          );
          return true;
        }

        return openEmailReplyComposerForMessage({
          ctx: context,
          message: target.message,
          replyType: 'reply-all',
          isLastMessage: target.isLastMessage,
        });
      }

      // No message focused: reply to the latest message, same as 'r'
      return openHotkeyTarget('reply-all');
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'escape',
    description: 'Collapse or unselect message',
    keyDownHandler: () => {
      // Skip if focus is in an editable area (compose input handles its own Escape)
      const activeEl = document.activeElement;
      if (
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.getAttribute('contenteditable') === 'true'
      ) {
        return false;
      }

      if (context.messages.hiddenChipFocused()) {
        clearSelection();
        return true;
      }

      if (keyboardSelecting() && listAnchor()) {
        clearSelection();
        return true;
      }

      const focusedId = context.messages.focusedID();
      if (!focusedId) {
        if (keyboardSelecting()) {
          clearSelection();
          return true;
        }
        return false;
      }

      // If there's an active reply, just clear it (don't collapse the message)
      if (context.messages.replyingToMessageId() === focusedId) {
        context.messages.setReplyingToMessageId(undefined);
        return true;
      }

      const target = getHotkeyTarget();
      if (target && isMessageRenderedExpanded(target)) {
        context.messages.setExpandedBodyId(focusedId, false);
        return true;
      }

      clearSelection();
      if (
        activeEl instanceof HTMLElement &&
        activeEl.closest(`[data-message-body-id="${CSS.escape(focusedId)}"]`)
      ) {
        activeEl.blur();
      }
      return true;
    },
    hotkeyToken: TOKENS.email.cancelReply,
    hide: true,
  });

  // On thread change: collapse the bottom reply, then re-evaluate auto-open
  // for the current thread's last message. Single effect to avoid an
  // ordering race between separate "reset on thread change" and "auto-open
  // on draft" effects (Solid runs effects in declaration order on first
  // mount, which can let the reset clobber the auto-open if both data
  // sources are synchronously available).
  let prevThreadId: string | undefined;
  createEffect(() => {
    const tid = props.threadId();
    if (prevThreadId !== tid) {
      prevThreadId = tid;
      context.messages.setBottomReplyOpen(false);
      context.mobileReplyComposer.close();
    }
    const filtered = context.messages.list();
    const lastMessage = filtered.at(-1);
    if (!lastMessage?.db_id) return;
    if (context.drafts.getDraftForMessage(lastMessage.db_id)) {
      if (isTouchDevice()) {
        context.mobileReplyComposer.openForMessage(lastMessage.db_id);
      } else {
        context.messages.setBottomReplyOpen(true);
      }
    }
  });

  const emailReplyInfo = createMemo(() => {
    const filtered = context.messages.list();

    // If there are non draft messages in this thread, the bottom input will
    // be for sending a reply to the last message
    if (filtered.length !== 0) {
      const lastMessage = filtered.at(-1);
      if (!lastMessage || !lastMessage.db_id) return;
      return {
        replyingTo: lastMessage,
        draft: context.drafts.getDraftForMessage(lastMessage.db_id),
      };
    }

    // Otherwise, if the other messages in the thread are drafts,
    // the bottom input will be for editing and sending the latest/last draft
    const unfiltered = context.messages.unfiltered();

    if (unfiltered.length === 0) return;

    const latest = unfiltered.at(-1);

    if (!latest || !latest.is_draft) return;

    return { replyingTo: undefined, draft: latest };
  });

  // The bottom reply area renders when the user can compose and there's a
  // message to reply to or a draft to edit. Returns the reply info so it can
  // drive the keyed <Show> around the reply area.
  const replyArea = () => {
    if (!context.permissions().isOwner) return;
    if (!context.drafts.initialDraftsSettled()) return;
    return emailReplyInfo();
  };

  // The expanded compose input, as opposed to the collapsed reply buttons
  // (which float in the mobile accessory region).
  const replyInputOpen = () =>
    context.messages.bottomReplyOpen() || emailReplyInfo()?.replyingTo == null;

  // Whether the compose input is rendered in normal flow.
  const replyInputInFlow = () => Boolean(replyArea() && replyInputOpen());

  const mobileBottomReplyMessage = createMemo(() => {
    if (context.mobileReplyComposer.open()) return;
    return replyArea()?.replyingTo;
  });

  return (
    <ModalsProvider subject={props.title}>
      <Show when={!isUserLoading()}>
        <Switch>
          <Match
            when={
              emailReplyInfo()?.replyingTo == null &&
              emailReplyInfo()?.draft?.db_id != null &&
              emailReplyInfo()?.draft
            }
          >
            {(draft) => (
              // The email block is bottom-anchored (no default panel inset),
              // so the compose branch pads around the chrome itself.
              <div class="size-full touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                <EmailCompose draftID={draft().db_id!} />
              </div>
            )}
          </Match>

          <Match when={true}>
            <EmailFormContextProvider
              formOptions={{
                getMessageByID: (id) =>
                  context.messages.unfiltered().find((m) => m.db_id === id),
                getDraftForMessageReply: context.drafts.getDraftForMessage,
                onRecipientsChange: context.onRecipientsChange,
                isPersonalMessage: (message) =>
                  isPersonalMessage(
                    message,
                    userEmail(),
                    context.messages.personalSenders()
                  ),
              }}
            >
              {/* Edge-to-edge on mobile/tablet: the message list carries its own
                  insets in-scroll and under-scrolls the floating chrome. */}
              <div class="size-full select-none overscroll-none overflow-hidden flex flex-col">
                <TopBar
                  id={props.threadId()}
                  title={props.title}
                  onCreateTask={openTaskCompose}
                  isDraft={
                    emailReplyInfo()?.replyingTo == null &&
                    emailReplyInfo()?.draft !== null
                  }
                />
                <SidePanel.Section
                  id="email-ai-actions"
                  title="Actions"
                  defaultOpen
                  order={0}
                >
                  <div class="m-px flex items-center justify-start gap-2">
                    <Show when={context.thread()?.db_id}>
                      {(threadId) => (
                        <AskMacroButton
                          entity={{
                            type: 'email',
                            id: threadId(),
                            name: props.title,
                          }}
                        />
                      )}
                    </Show>
                    <Show when={context.thread()?.db_id}>
                      <EmailTaskButton onClick={openTaskCompose} />
                    </Show>
                  </div>
                </SidePanel.Section>
                <div
                  class="w-full flex-1 flex flex-col items-center overflow-hidden"
                  ref={context.registerMessagesContainer}
                >
                  <MessageList
                    initialLoadComplete={context.initialLoadComplete()}
                    markdownDomRef={(el) => {
                      markdownDomRef = el;
                    }}
                    title={props.title}
                    underScrollsBottom={!replyInputInFlow()}
                    showMiddleMessages={showMiddleMessages()}
                    hiddenChipFocused={context.messages.hiddenChipFocused()}
                    allowRowHover={!keyboardSelecting()}
                    onHiddenChipFocus={() => {
                      armKeyboardPointer();
                      context.messages.setFocused(undefined);
                      context.messages.setHiddenChipFocused(true);
                    }}
                    onOpenMiddle={() => {
                      leaveHiddenChip();
                      setUserOpenedMiddle(true);
                    }}
                  />
                  <CustomScrollbar scrollContainer={context.messagesListRef} />
                </div>
                <Show when={isTouchDevice() && mobileBottomReplyMessage()}>
                  {(lastMessage) => (
                    <BottomReplyButtons lastMessage={lastMessage()} />
                  )}
                </Show>
                <Show when={isTouchDevice()}>
                  <MobileEmailComposeDrawer
                    markdownDomRef={(el) => {
                      markdownDomRef = el;
                    }}
                  />
                </Show>
              </div>
            </EmailFormContextProvider>
          </Match>
        </Switch>
      </Show>
    </ModalsProvider>
  );
}

function EmailTaskButton(props: { onClick: () => void }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      tooltip="Create Task"
      variant="ghost"
      size="sm"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={props.onClick}
      depth={2}
      class="gap-1.5 rounded-full border border-edge-muted px-2 text-ink-extra-muted"
    >
      <AnimatedTaskIcon triggerAnimation={hovering()} />
      <span class="text-xs font-semibold">Task</span>
    </Button>
  );
}
