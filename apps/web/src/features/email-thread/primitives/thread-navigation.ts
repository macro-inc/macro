import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { createCallback } from '@solid-primitives/rootless';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import type {
  EmailThreadContext,
  EmailThreadHost,
} from '../context/email-thread-context';
import {
  adjacentStop,
  nextThreadStop,
  shownStops,
  type ThreadStop,
  threadStopFromHover,
} from '../core/thread-stops';
import { openEmailReplyComposerForMessage } from '../primitives/reply-actions';
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
} from '../primitives/scroll-to-message';
import type { EmailThreadState } from './email-thread-state';

const TARGET_MESSAGE_HIGHLIGHT_MS = 800;
/** List navigation — keep within the 300ms UI motion budget (improve-animations). */
const SCROLL_ANIMATION_MS = 250;
const KEYBOARD_SCROLL_MS = 250;

export function createThreadNavigation(
  props: { threadId: Accessor<string> },
  context: EmailThreadState,
  threadContext: EmailThreadContext,
  host: EmailThreadHost = {}
) {
  const isTouchDevice = threadContext.isTouch;
  const setIsScrollingToMessage = context.setIsScrollingToMessage;
  let disposed = false;
  const pendingWaits = new Set<() => void>();
  onCleanup(() => {
    disposed = true;
    for (const finish of pendingWaits) finish();
  });
  /**
   * Waits for the query to finish fetching
   */
  const waitForQueryLoad = (): Promise<void> => {
    return new Promise((resolve) => {
      const finish = () => {
        clearInterval(checkInterval);
        pendingWaits.delete(finish);
        resolve();
      };
      const checkInterval = setInterval(() => {
        if (disposed || !context.query.isFetching()) finish();
      }, 50);
      pendingWaits.add(finish);
    });
  };

  /**
   * Loads messages until the target message is found or no more messages available
   */
  const loadMessagesUntilFound = async (
    targetMessageId: string
  ): Promise<boolean> => {
    const ownerThreadId = props.threadId();
    while (!disposed && props.threadId() === ownerThreadId) {
      const messages = context.messages.unfiltered();

      // Check if message exists in current batch
      const messageExists = messages.some(
        (m: EmailMessage) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!context.query.hasMore()) return false;

      // Load next batch and wait
      await context.query.fetchNextPage();
      await waitForQueryLoad();
      if (context.messages.unfiltered().length <= messages.length) return false;
    }
    return false;
  };

  const fetchNextPage = async () => {
    if (context.query.hasMore() && !context.query.isFetching()) {
      context.query.fetchNextPage();
      await waitForQueryLoad();
    }
  };

  const canRunInitialEmailScroll = () =>
    !isTouchDevice() || host.isActive?.() !== false;

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
      host.focusContainer?.();
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

    if (context.messages.targetMessageId() === messageId) {
      setTimeout(() => {
        context.messages.setTargetMessageId(undefined);
      }, TARGET_MESSAGE_HIGHLIGHT_MS);
    }

    setTimeout(() => setIsScrollingToMessage(false), SCROLL_ANIMATION_MS);

    return true;
  };

  context.onInitialDataLoad(() => {
    if (!canRunInitialEmailScroll()) return false;
    if (!untrack(context.messagesListRef)) return false;

    const targetMessageId_ = context.messages.targetMessageId();
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
    const focus = context.messages.focusedId();
    const target = context.messages.targetMessageId();
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
    messages: EmailMessage[],
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

    // Arrow navigation owns focus, including when it only scrolls the current
    // card. Enter should act on that selection rather than the previous button.
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLButtonElement) {
      activeElement.blur();
      host.focusContainer?.();
    }

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
      const focusedId = context.messages.focusedId();
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
    const selectedId = context.messages.focusedId();
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

  const getHotkeyTarget = () => {
    const messages = context.messages.list();
    if (messages.length === 0) return;

    const focusedId = context.messages.focusedId();
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
      isMobile: threadContext.isMobile(),
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
  });
  const activate = () => {
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

    // The host captures Enter before a focused button receives it. Let the
    // button activate itself instead of opening a reply on the thread.
    if (document.activeElement instanceof HTMLButtonElement) return false;

    const focusedId = context.messages.focusedId();
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
        isMobile: threadContext.isMobile(),
        message: target.message,
        replyType: 'reply-all',
        isLastMessage: target.isLastMessage,
      });
    }

    // No message focused: reply to the latest message, same as 'r'
    return openHotkeyTarget('reply-all');
  };
  const cancel = () => {
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

    const focusedId = context.messages.focusedId();
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
  };
  onMount(() =>
    host.registerKeyboard?.({
      replyToFocusedMessage: () => openHotkeyTarget('reply-all'),
      replyAllToFocusedMessage: () => openHotkeyTarget('reply-all'),
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
      activate,
      cancel,
    })
  );

  return {
    showMiddleMessages,
    keyboardSelecting,
    armKeyboardPointer,
    leaveHiddenChip,
    setUserOpenedMiddle,
    setMarkdownDomRef: (el: HTMLDivElement) => {
      markdownDomRef = el;
    },
  };
}
