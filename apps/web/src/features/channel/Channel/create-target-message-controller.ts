import { createMachine } from '@macro-inc/machine';
import {
  type ChannelMessagesData,
  getChannelMessagesQueryKey,
} from '@queries/channel/channel-messages';
import { queryClient } from '@queries/client';
import { type Accessor, onCleanup, untrack } from 'solid-js';
import { match } from 'ts-pattern';
import type { ThreadListNavigation } from './ThreadList';
import {
  activeTargetMessageId,
  activeTargetMessageReplyId,
  type Command,
  type Event,
  hasPendingElementScroll,
  initialState,
  pendingScrollTargetId,
  pendingTargetReplyId,
  type State,
  targetMessageDef,
} from './target-message';

/**
 * How long a navigation target keeps its accent highlight after its scroll
 * has positioned it on screen. When the flash elapses the target releases
 * itself; highlights owned by other state (e.g. the unified input's reply
 * binding) are unaffected.
 */
export const TARGETED_MESSAGE_FLASH_MS = 1000;

type CreateTargetMessageControllerOptions = {
  channelId: Accessor<string>;
  initialTargetMessageId?: string | undefined;
  initialTargetMessageReplyId?: string | undefined;
  messageKeys: Accessor<string[]>;
  navigation: Accessor<ThreadListNavigation | undefined>;
  /**
   * Whether the ThreadList has completed its initial scroll. Target
   * positioning waits for this so a `goToMessage` that fires mid-initial-scroll
   * isn't overridden by ThreadList's retry logic, which validates against the
   * *original* scroll target.
   */
  didInitialScroll: Accessor<boolean>;
};

export type TargetMessageController = ReturnType<
  typeof createTargetMessageController
>;

/**
 * Runner for the target-message machine. All decisions live in
 * `target-message.ts`; this file owns the three things that touch the
 * world: the flash timer, cache restoration, and the readiness condition.
 * No effects: readiness is a derivation the selectors consume.
 */
export function createTargetMessageController(
  options: CreateTargetMessageControllerOptions
) {
  const machine = createMachine<State, Event, Command>({
    initial: initialState({
      messageId: options.initialTargetMessageId,
      replyId: options.initialTargetMessageReplyId,
    }),
    def: targetMessageDef,

    scopes: {
      flashing: (_s, dispatch) => {
        const timer = setTimeout(
          () => dispatch({ t: 'flash-elapsed' }),
          TARGETED_MESSAGE_FLASH_MS
        );
        onCleanup(() => clearTimeout(timer));
      },
    },

    execute: (cmd, dispatch) => {
      match(cmd)
        .with({ t: 'restore-default-pagination' }, (cmd) => {
          const restored = restoreDefaultChannelPaginationAfterTargetLoad(
            options.channelId(),
            cmd.loadAround
          );
          if (restored) dispatch({ t: 'pagination-restored' });
        })
        .exhaustive();
    },

    inspect: import.meta.env.DEV
      ? (from, e, result) =>
          console.debug('target-message', {
            from: from.t,
            event: e.t,
            to: result === 'ignored' ? 'ignored' : result.state.t,
          })
      : undefined,
  });

  const state = machine.state;

  // A function, not a memo: Channel.tsx constructs this controller before
  // `messageIndex` exists, so eagerly reading `messageKeys` would throw.
  // Accessors run after setup and track these inputs from there.
  const ready = () => {
    const s = state();
    return (
      s.t === 'targeting' &&
      options.navigation() !== undefined &&
      options.didInitialScroll() &&
      options.messageKeys().includes(s.target.messageId)
    );
  };

  return {
    activeTargetMessageId: () => activeTargetMessageId(state()),
    activeTargetMessageReplyId: () => activeTargetMessageReplyId(state()),
    loadAroundMessageId: () => state().loadAround,
    pendingScrollTargetId: () => pendingScrollTargetId(state(), ready()),
    pendingTargetReplyId: () => pendingTargetReplyId(state()),
    hasPendingElementScroll: () => hasPendingElementScroll(state(), ready()),

    goToMessage: (messageId: string, replyId?: string) =>
      machine.dispatch({
        t: 'navigate',
        target: { messageId, replyId },
        targetLoaded: untrack(() => options.messageKeys().includes(messageId)),
        ready: untrack(ready),
      }),
    completePendingScroll: (messageId: string) =>
      machine.dispatch({ t: 'root-scroll-done', messageId }),
    completePendingReplyScroll: (messageId: string, replyId: string) =>
      machine.dispatch({ t: 'reply-scroll-done', messageId, replyId }),
    clearActiveTarget: (messageId: string) =>
      machine.dispatch({ t: 'release', messageId }),
    reset: () => machine.dispatch({ t: 'reset' }),
  };
}

/**
 * Promote the around-query's data to the default channel query once the
 * target has been positioned, so subsequent pagination continues from the
 * loaded window instead of refetching from the bottom. Returns whether
 * anything was restored. Idempotent: the around variant is removed on success.
 */
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
