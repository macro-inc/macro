import { createSolidMachine } from '@macro-inc/machine/solid';
import { markNotificationTargetVisible } from '@notifications/notification-open-trace';
import { queryClient } from '@queries/client';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
} from '@queries/messages/timeline';
import { type Accessor, batch, createSignal, untrack } from 'solid-js';
import { match } from 'ts-pattern';
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
  /** The list publishes its handle after initial layout and positioning. */
  isReady: Accessor<boolean>;
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
  const machine = createSolidMachine<State, Event, Command>({
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
        return () => clearTimeout(timer);
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
      options.isReady() &&
      options.messageKeys().includes(s.target.messageId)
    );
  };

  // The window the list shows, which `loadAround` alone cannot name: two
  // latest windows share its `undefined`, and the scroll ack's promotion
  // clears it while the list keeps the window it had. A target outside the
  // loaded window and a reset (a channel change, or a missing target falling
  // back to latest) replace the window.
  const [windowKey, setWindowKey] = createSignal(0);
  const replaceWindow = () => setWindowKey((n) => n + 1);

  return {
    activeTargetMessageId: () => activeTargetMessageId(state()),
    activeTargetMessageReplyId: () => activeTargetMessageReplyId(state()),
    loadAroundMessageId: () => state().loadAround,
    windowKey,
    pendingScrollTargetId: () => pendingScrollTargetId(state(), ready()),
    pendingTargetReplyId: () => pendingTargetReplyId(state()),
    hasPendingElementScroll: () => hasPendingElementScroll(state(), ready()),

    // Batched, so no reader sees the new target with the window it replaced.
    goToMessage: (messageId: string, replyId?: string) =>
      batch(() => {
        const before = untrack(state).loadAround;
        machine.dispatch({
          t: 'navigate',
          target: { messageId, replyId },
          targetLoaded: untrack(() =>
            options.messageKeys().includes(messageId)
          ),
          ready: untrack(ready),
        });
        if (untrack(state).loadAround !== before) replaceWindow();
      }),
    completePendingScroll: (messageId: string) => {
      const before = state();
      machine.dispatch({ t: 'root-scroll-done', messageId });
      if (
        before.t === 'targeting' &&
        before.target.messageId === messageId &&
        !before.target.replyId &&
        state().t === 'flashing'
      )
        markNotificationTargetVisible(options.channelId(), messageId);
    },
    completePendingReplyScroll: (messageId: string, replyId: string) => {
      const before = state();
      machine.dispatch({ t: 'reply-scroll-done', messageId, replyId });
      if (
        before.t === 'targeting' &&
        before.target.messageId === messageId &&
        before.target.replyId === replyId &&
        state().t === 'flashing'
      )
        markNotificationTargetVisible(options.channelId(), replyId);
    },
    clearActiveTarget: (messageId: string) =>
      machine.dispatch({ t: 'release', messageId }),
    reset: () =>
      batch(() => {
        machine.dispatch({ t: 'reset' });
        replaceWindow();
      }),
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

  const aroundKey = getMessageTimelineQueryKey(
    { type: 'channel', id: channelId },
    loadAroundMessageId
  );
  const defaultKey = getMessageTimelineQueryKey(
    { type: 'channel', id: channelId },
    null
  );
  const aroundData = queryClient.getQueryData<MessageTimelineData>(aroundKey);
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
  const defaultKey = getMessageTimelineQueryKey(
    { type: 'channel', id: channelId },
    null
  );
  const cached = queryClient.getQueryData<MessageTimelineData>(defaultKey);
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
