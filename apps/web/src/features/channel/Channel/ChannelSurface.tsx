import {
  fetchResolvedChannelMessage,
  findThreadIdInMessageTimeline,
  findTopLevelMessageInMessageTimeline,
} from '@queries/messages/timeline';
import type { MessageParent } from '@service-storage/messages';
import {
  type Accessor,
  createComputed,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  untrack,
  useContext,
} from 'solid-js';
import {
  Channel,
  type ChannelHandle,
  type MessageTimelineStateSnapshot,
} from './Channel';

/**
 * A navigation intent for a channel. Hosts own this as state and pass it
 * down; a fresh object per user action is what re-navigates, so repeating
 * the same target (re-clicking an inbox row) means creating a new request.
 */
export type ChannelTargetRequest =
  | { kind: 'message'; messageId: string; threadId?: string }
  | { kind: 'latest' };

/** A request resolved against the channel/thread model, identity-stable per request. */
export type ChannelResolvedTarget =
  | { kind: 'latest'; request: ChannelTargetRequest }
  | {
      kind: 'message';
      request: ChannelTargetRequest;
      targetMessageId: string;
      targetMessageReplyId?: string;
    };

export type ChannelSurfaceApi = {
  /** Live timeline state while messages are mounted, else the last state seen. */
  getMessagesStateSnapshot: () => MessageTimelineStateSnapshot | undefined;
};

export type ChannelSurfaceProps = {
  channelId: string;
  /** Latest navigation intent; see {@link ChannelTargetRequest}. */
  targetRequest?: ChannelTargetRequest;
  /** Timeline state to restore when messages first mount (persisted by the host). */
  initialMessagesState?: MessageTimelineStateSnapshot;
  ref?: (api: ChannelSurfaceApi) => void;
};

type ChannelSurfaceContextValue = {
  channelId: Accessor<string>;
  resolvedTarget: Accessor<ChannelResolvedTarget | undefined>;
};

type ChannelSurfaceInternal = ChannelSurfaceContextValue & {
  initialMessagesState: Accessor<MessageTimelineStateSnapshot | undefined>;
  bindMessagesHandle: (handle: ChannelHandle | undefined) => void;
  isTargetConsumed: (target: ChannelResolvedTarget) => boolean;
  markTargetConsumed: (target: ChannelResolvedTarget) => void;
};

const ChannelSurfaceContext = createContext<ChannelSurfaceInternal>();

export function useChannelSurface(): ChannelSurfaceContextValue {
  return useChannelSurfaceInternal();
}

function useChannelSurfaceInternal(): ChannelSurfaceInternal {
  const context = useContext(ChannelSurfaceContext);
  if (!context) {
    throw new Error('useChannelSurface must be used within <ChannelSurface>');
  }
  return context;
}

/**
 * Resolve a request from what is already known: `latest` and explicit-thread
 * targets need no lookup, and a bare message id is checked against the cached
 * timeline. Returns undefined only when the id is genuinely unknown.
 */
function resolveSync(
  channelId: string,
  request: ChannelTargetRequest
): ChannelResolvedTarget | undefined {
  if (request.kind === 'latest') return { kind: 'latest', request };
  const { messageId, threadId } = request;
  // A thread root references itself as its thread: an unambiguous top-level
  // target, resolved without any lookup (same rule as convertTargetMessage).
  if (threadId === messageId) {
    return { kind: 'message', request, targetMessageId: messageId };
  }
  if (threadId) {
    return {
      kind: 'message',
      request,
      targetMessageId: threadId,
      targetMessageReplyId: messageId,
    };
  }
  const parent: MessageParent = { type: 'channel', id: channelId };
  if (findTopLevelMessageInMessageTimeline(parent, messageId)) {
    return { kind: 'message', request, targetMessageId: messageId };
  }
  const cachedThreadId = findThreadIdInMessageTimeline(parent, messageId);
  if (cachedThreadId) {
    return {
      kind: 'message',
      request,
      targetMessageId: cachedThreadId,
      targetMessageReplyId: messageId,
    };
  }
}

/**
 * Tab-agnostic channel context. Owns target resolution and the messages
 * timeline snapshot; knows nothing about tabs, calls, or host chrome. Layers
 * above attach by passing state down (`targetRequest`) or mounting parts
 * (`ChannelMessages`) — the surface exposes no registration hooks beyond the
 * single `ref` escape hatch for the host's persistence captor.
 *
 * Hosts must remount the surface when `channelId` changes (key it).
 */
export function ChannelSurface(props: ParentProps<ChannelSurfaceProps>) {
  const [resolvedTarget, setResolvedTarget] =
    createSignal<ChannelResolvedTarget>();

  // Resolution runs once per request (not as a derived memo) so the resolved
  // object stays identity-stable while cache contents shift underneath, and
  // so the sync fast path lands in the same tick — a resource would resolve
  // in a microtask and initial targets would miss the messages mount.
  createComputed(
    on(
      [() => props.channelId, () => props.targetRequest],
      ([channelId, request]) => {
        if (!request) {
          setResolvedTarget(undefined);
          return;
        }
        const sync = untrack(() => resolveSync(channelId, request));
        if (sync) {
          setResolvedTarget(sync);
          return;
        }
        setResolvedTarget(undefined);
        if (request.kind !== 'message') return;
        void (async () => {
          const resolved = await fetchResolvedChannelMessage(
            { type: 'channel', id: channelId },
            request.messageId
          ).catch(() => undefined);
          if (props.targetRequest !== request) return;
          setResolvedTarget(
            resolved?.kind === 'thread_reply'
              ? {
                  kind: 'message',
                  request,
                  targetMessageId: resolved.thread_id,
                  targetMessageReplyId: request.messageId,
                }
              : {
                  kind: 'message',
                  request,
                  targetMessageId: request.messageId,
                }
          );
        })();
      }
    )
  );

  const [messagesHandle, setMessagesHandle] = createSignal<ChannelHandle>();
  let lastMessagesSnapshot = untrack(() => props.initialMessagesState);
  const bindMessagesHandle = (handle: ChannelHandle | undefined) => {
    if (!handle) {
      lastMessagesSnapshot =
        untrack(messagesHandle)?.getMessagesStateSnapshot() ??
        lastMessagesSnapshot;
    }
    setMessagesHandle(() => handle);
  };

  // A resolved target is consumed exactly once — by riding into the messages
  // mount as initial props or by a live handle navigation. Tracked here, not
  // in the part, so a messages remount (tab away and back) restores its state
  // instead of replaying an already-shown target.
  let consumedTarget: ChannelResolvedTarget | undefined;

  props.ref?.({
    getMessagesStateSnapshot: () =>
      messagesHandle()?.getMessagesStateSnapshot() ?? lastMessagesSnapshot,
  });

  return (
    <ChannelSurfaceContext.Provider
      value={{
        channelId: () => props.channelId,
        resolvedTarget,
        // The messages part restores from here on every mount: the host's
        // initial state until the first cleanup stashes something fresher, so
        // leaving the messages pane and returning keeps scroll/thread/reply
        // state rather than resetting to the host's snapshot.
        initialMessagesState: () => lastMessagesSnapshot,
        bindMessagesHandle,
        isTargetConsumed: (target) => target === consumedTarget,
        markTargetConsumed: (target) => {
          consumedTarget = target;
        },
      }}
    >
      {props.children}
    </ChannelSurfaceContext.Provider>
  );
}

export type ChannelMessagesProps = {
  /** Whether to auto-focus the channel input on mount. Defaults to `!isTouchDevice()`. */
  autofocus?: boolean;
};

/**
 * The messages timeline part. Mounts `Channel` against the surface: an
 * unconsumed message target at mount rides in as initial props (load-around
 * from the first frame); everything else — a pending `latest` target, targets
 * that resolve later, targets that arrive while mounted — navigates through
 * the live handle. An already-consumed target is not replayed, so remounting
 * restores the stashed timeline state instead.
 */
export function ChannelMessages(props: ChannelMessagesProps) {
  const surface = useChannelSurfaceInternal();
  const [handle, setHandle] = createSignal<ChannelHandle>();
  const mountTarget = untrack(surface.resolvedTarget);
  // A pending `latest` cannot ride into the mount — Channel would restore the
  // snapshot and stay there — so it is left unconsumed for the effect below.
  const initialTarget =
    mountTarget?.kind === 'message' && !surface.isTargetConsumed(mountTarget)
      ? mountTarget
      : undefined;
  if (initialTarget) surface.markTargetConsumed(initialTarget);

  createEffect(() => {
    const target = surface.resolvedTarget();
    const channelHandle = handle();
    if (!channelHandle || !target || surface.isTargetConsumed(target)) return;
    surface.markTargetConsumed(target);
    if (target.kind === 'latest') {
      channelHandle.goToLatest();
    } else {
      channelHandle.goToMessage(
        target.targetMessageId,
        target.targetMessageReplyId
      );
    }
  });

  onCleanup(() => surface.bindMessagesHandle(undefined));

  return (
    <Channel
      channelId={surface.channelId()}
      onHandleReady={(channelHandle) => {
        setHandle(() => channelHandle);
        surface.bindMessagesHandle(channelHandle);
      }}
      autofocus={props.autofocus}
      // A mount that load-arounds a target must not also restore old timeline
      // state — the same rule as the block host's hydration gate.
      initialMessagesStateSnapshot={
        initialTarget ? undefined : surface.initialMessagesState()
      }
      targetMessageId={initialTarget?.targetMessageId}
      targetMessageReplyId={initialTarget?.targetMessageReplyId}
    />
  );
}
