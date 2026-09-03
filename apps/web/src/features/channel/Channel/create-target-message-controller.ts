import {
  type ChannelMessagesData,
  getChannelMessagesQueryKey,
} from '@queries/channel/channel-messages';
import { queryClient } from '@queries/client';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  activeTargetMessageId,
  activeTargetMessageReplyId,
  type Command,
  hasPendingElementScroll,
  initialState,
  loadAroundMessageId,
  type MachineState,
  pendingScrollTargetId,
  pendingTargetReplyId,
  reduce,
  type TargetEvent,
} from '../domain/target-message';
import type { ThreadListNavigation } from './ThreadList';

export const TARGETED_MESSAGE_FLASH_MS = 1000;

type CreateTargetMessageControllerOptions = {
  channelId: Accessor<string>;
  initialTargetMessageId?: string | undefined;
  initialTargetMessageReplyId?: string | undefined;
  messageKeys: Accessor<string[]>;
  navigation: Accessor<ThreadListNavigation | undefined>;
  /**
   * Whether the ThreadList has completed its initial scroll.
   *
   * The controller defers pending scroll execution until this returns `true`
   * so that a `goToMessage` call that fires while the initial scroll is still
   * in progress does not get overridden by the initial-scroll retry logic
   * inside ThreadList.
   */
  didInitialScroll: Accessor<boolean>;
};

export type TargetMessageController = ReturnType<
  typeof createTargetMessageController
>;

export function createTargetMessageController(
  options: CreateTargetMessageControllerOptions
) {
  const [state, setState] = createSignal<MachineState>(
    initialState({
      messageId: options.initialTargetMessageId,
      replyId: options.initialTargetMessageReplyId,
    })
  );

  let flashTimeout: ReturnType<typeof setTimeout> | undefined;

  const cancelFlash = () => {
    if (flashTimeout === undefined) return;
    clearTimeout(flashTimeout);
    flashTimeout = undefined;
  };

  const runCommands = (commands: Command[]) => {
    for (const command of commands) {
      match(command)
        .with({ t: 'cancel-flash' }, () => {
          cancelFlash();
        })
        .with({ t: 'schedule-flash' }, ({ messageId }) => {
          cancelFlash();
          flashTimeout = setTimeout(() => {
            flashTimeout = undefined;
            dispatch({ t: 'flash-elapsed', messageId });
          }, TARGETED_MESSAGE_FLASH_MS);
        })
        .with({ t: 'restore-default-pagination' }, ({ loadAround }) => {
          const restored = restoreDefaultChannelPaginationAfterTargetLoad(
            options.channelId(),
            loadAround
          );
          if (restored) dispatch({ t: 'pagination-restored' });
        })
        .exhaustive();
    }
  };

  const dispatch = (event: TargetEvent) => {
    const { state: next, commands } = reduce(state(), event);
    setState(next);
    runCommands(commands);
  };

  onCleanup(cancelFlash);

  createEffect(
    on(
      [() => state().control, options.messageKeys],
      ([control, messageKeys]) => {
        if (
          control.t === 'loading' &&
          messageKeys.includes(control.target.messageId)
        ) {
          dispatch({ t: 'target-loaded' });
        }
      }
    )
  );

  createEffect(
    on(
      [() => state().control, options.navigation, options.didInitialScroll],
      ([control, navigation, didInitialScroll]) => {
        if (
          control.t === 'awaiting-viewport' &&
          navigation &&
          didInitialScroll
        ) {
          dispatch({ t: 'viewport-ready' });
        }
      }
    )
  );

  return {
    activeTargetMessageId: () => activeTargetMessageId(state()),
    activeTargetMessageReplyId: () => activeTargetMessageReplyId(state()),
    loadAroundMessageId: () => loadAroundMessageId(state()),
    pendingScrollTargetId: () => pendingScrollTargetId(state()),
    pendingTargetReplyId: () => pendingTargetReplyId(state()),
    hasPendingElementScroll: () => hasPendingElementScroll(state()),

    goToMessage: (messageId: string, replyId?: string) => {
      dispatch({
        t: 'navigate',
        messageId,
        replyId,
        targetLoaded: options.messageKeys().includes(messageId),
      });
    },
    completePendingScroll: (messageId: string) => {
      dispatch({ t: 'root-scroll-done', messageId });
    },
    completePendingReplyScroll: (messageId: string, replyId: string) => {
      dispatch({ t: 'reply-scroll-done', messageId, replyId });
    },
    clearActiveTarget: (messageId: string) => {
      dispatch({ t: 'release', messageId });
    },
    reset: () => {
      dispatch({ t: 'reset' });
    },
  };
}

export function restoreDefaultChannelPaginationAfterTargetLoad(
  channelId: string,
  loadAroundMessageId: string | undefined
) {
  if (!loadAroundMessageId) return false;

  const aroundKey = getChannelMessagesQueryKey(channelId, loadAroundMessageId);
  const defaultKey = getChannelMessagesQueryKey(channelId, null);
  const aroundData = queryClient.getQueryData<ChannelMessagesData>(aroundKey);
  if (!aroundData) return false;

  queryClient.setQueryData(defaultKey, aroundData);
  queryClient.removeQueries({ queryKey: aroundKey });
  return true;
}

/**
 * When opening a channel without a target, the default query may still hold
 * stale data that was restored from a previous load-around session. A normal
 * latest-messages load never has `previous_cursor` on its first page (there
 * are no newer messages). If we detect that cursor, the data is stale and
 * centered on an old target — remove it so the query fetches from the bottom.
 */
export function clearStaleRestoredChannelData(channelId: string) {
  const defaultKey = getChannelMessagesQueryKey(channelId, null);
  const cached = queryClient.getQueryData<ChannelMessagesData>(defaultKey);
  if (!cached?.pages.length) return;

  // Check both the page cursor AND pageParams[0]. After fetchPreviousPage,
  // pageParams[0] contains { previous_cursor } even if pages[0].previous_cursor
  // might be different. A fresh load should have pageParams[0] = null.
  const pageParams = cached.pageParams;
  const hasStalePageParams = pageParams?.[0] != null;
  const hasStalePageCursor = !!cached.pages[0].previous_cursor;

  if (hasStalePageParams || hasStalePageCursor) {
    queryClient.removeQueries({ queryKey: defaultKey });
  }
}
