import { useFlowTrace } from '@app/observability/flow';
import type { DateValue } from '@core/util/date';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  type ChannelDirectory,
  type ChannelLookup,
  createAppChannelDirectory,
  sameChannelLookup,
} from '@queries/channel/directory';
import {
  BOT_PRINCIPAL_PREFIX,
  type DirectoryChannel,
  type DirectoryChannelType,
} from '@queries/channel/directory-core';
import { isLaterView, readChannelViewedAt } from '@queries/channel/viewed-at';
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
import { createAssertedContextProvider } from './createContext';
import { useUserId } from './user';

export type { ChannelDirectory, ChannelLookup, DirectoryChannel };

/** When the viewer last viewed a channel: `pending` until that is known,
 * `known` (null when they never did), or `unknown` when the server could not
 * say. */
export type ChannelLastViewed =
  | { status: 'pending' }
  | { status: 'known'; viewedAt: string | null }
  | { status: 'unknown' };

const LAST_VIEW_PENDING: ChannelLastViewed = { status: 'pending' };
const LAST_VIEW_UNKNOWN: ChannelLastViewed = { status: 'unknown' };

/** How long an open waits for the server's answer before it records its own
 * view without one, ending the request. An answer after that could already
 * be that view. */
export const LAST_VIEW_WAIT_MS = 5_000;

function sameLastViewed(a: ChannelLastViewed, b: ChannelLastViewed) {
  return a.status === b.status && knownLastView(a) === knownLastView(b);
}

/** Why an open stopped waiting for the server's answer: `LAST_VIEW_WAIT_MS`
 * passed, the directory's record settled the open first, or the open
 * closed. Each one ends the request. */
type LastViewStop = 'timed_out' | 'superseded' | 'closed';

/** One open's ask of the server. */
type LastViewAsk = {
  /** Aborts once the open stops waiting. */
  signal: AbortSignal;
  /** Why the open stopped waiting, once it has. */
  stopped: () => LastViewStop | undefined;
  /** Gives the open the server's answer, which it still waits for. */
  take: (state: ChannelLastViewed) => void;
};

/** Asks the server in a span that records what became of the answer: `used`,
 * or why the open stopped waiting. Stopping aborts the read, which ends the
 * request and the span with it. */
async function askLastView(channelId: string, ask: LastViewAsk) {
  await Telemetry.span('channel.last_view', async (span) => {
    span.setAttr('channel.id', channelId);
    const viewedAt = await readChannelViewedAt(channelId, ask.signal);
    const stopped = ask.stopped();
    if (stopped) {
      span.setAttr('channel.last_view.outcome', stopped);
      return;
    }
    if (viewedAt.isErr()) span.error(viewedAt.error);
    ask.take(
      viewedAt.isOk()
        ? { status: 'known', viewedAt: viewedAt.value }
        : LAST_VIEW_UNKNOWN
    );
    span.setAttr('channel.last_view.outcome', 'used');
  });
}

/**
 * Asks the server for an open's last view until the open stops waiting: the
 * answer arrives, `LAST_VIEW_WAIT_MS` pass, the directory's record settles
 * the open first, or the open closes. Stopping ends the request. Runs under
 * the open's owner.
 */
function askWhileOpen(
  channelId: string,
  lastViewed: Accessor<ChannelLastViewed>,
  setAnswer: (state: ChannelLastViewed) => void,
  flow: TraceContext | undefined
) {
  const controller = new AbortController();
  let stoppedBy: LastViewStop | undefined;
  let answered = false;
  // Each way out marks itself before it writes the answer: a write that
  // settles the open runs the record's stop below at once.
  function stop(why: LastViewStop) {
    if (answered || stoppedBy) return;
    stoppedBy = why;
    clearTimeout(wait);
    controller.abort();
  }
  const wait = setTimeout(() => {
    stop('timed_out');
    setAnswer(LAST_VIEW_UNKNOWN);
  }, LAST_VIEW_WAIT_MS);
  onCleanup(() => stop('closed'));
  // What's new is marked from the first view the open settles on (the
  // activity tracker keeps it), so once the record settles it, no answer can
  // change it.
  createEffect(
    on(
      () => lastViewed().status !== 'pending',
      (settled) => {
        if (settled) stop('superseded');
      }
    )
  );
  const ask = () =>
    askLastView(channelId, {
      signal: controller.signal,
      stopped: () => stoppedBy,
      take(state) {
        answered = true;
        clearTimeout(wait);
        setAnswer(state);
      },
    });
  fireAndForget(flow ? flow.run(ask) : ask(), 'channel-viewed-at');
}

type ChannelDirectoryProviderProps = {
  /** A directory to provide instead of the app's, for tests and fixtures. */
  directory?: ChannelDirectory;
};

/**
 * The viewer's channels for the app: one directory, read from the GraphQL
 * cache (or the network without one), shared by every reader under it.
 */
export const [ChannelDirectoryProvider, useChannelDirectory] =
  createAssertedContextProvider(
    'ChannelDirectory',
    (props: ChannelDirectoryProviderProps): ChannelDirectory =>
      props.directory ?? createAppChannelDirectory()
  );

/** One channel the viewer joined: `pending` while a cold directory cannot
 * tell yet, `missing` when it is not one of theirs. */
export function useChannelLookup(
  channelId: string | Accessor<string>
): Accessor<ChannelLookup> {
  const directory = useChannelDirectory();
  // A by-id read the lookup starts joins the view that asked, while it loads.
  const flow = useFlowTrace();
  const id = typeof channelId === 'string' ? () => channelId : channelId;
  return createMemo(() => directory.lookup(id(), flow), undefined, {
    equals: sameChannelLookup,
  });
}

/** The joined channel a lookup found, undefined while pending or missing. */
export function loadedChannel(
  lookup: ChannelLookup
): DirectoryChannel | undefined {
  return lookup.status === 'loaded' ? lookup.channel : undefined;
}

/** A channel the viewer joined, undefined while pending or missing. */
export function useChannel(
  channelId: string | Accessor<string>
): Accessor<DirectoryChannel | undefined> {
  const lookup = useChannelLookup(channelId);
  return createMemo(() => loadedChannel(lookup()));
}

/**
 * When the viewer last viewed a channel, as it opens. A joined channel's view
 * is on its directory record once the directory's views are current. For any
 * other channel (one they left or never joined, or one a cold directory
 * cannot place yet), and for a joined one while its record may hold a view
 * older than one made elsewhere since, the server answers once, from the
 * viewer's own activity row, which keeps their views after they leave; a
 * record then shows the later of its view and the answer. Record the open's
 * own view only once this is no longer `pending`, or the answer can be that
 * view. The ask stops, ending its request, as soon as the open no longer
 * waits for it.
 */
export function useChannelLastViewed(
  channelId: string
): Accessor<ChannelLastViewed> {
  const directory = useChannelDirectory();
  const lookup = useChannelLookup(channelId);
  const [answer, setAnswer] = createSignal(LAST_VIEW_PENDING);
  // Decided before the first read below, which an open may already keep.
  const asks = untrack(
    () => lookup().status !== 'loaded' || !directory.viewsCurrent()
  );
  const lastViewed = createMemo(
    (previous): ChannelLastViewed => {
      const found = lookup();
      const asked = answer();
      if (found.status === 'loaded') {
        const recorded = found.channel.viewedAt;
        if (asked.status === 'known')
          return { status: 'known', viewedAt: laterView(recorded, asked) };
        // A record older than this page waits for the answer, unless a pass
        // rereads it first.
        if (asked.status === 'pending' && asks && !directory.viewsCurrent())
          return previous;
        return { status: 'known', viewedAt: recorded };
      }
      // A channel left while open keeps the view its record had.
      return asked.status === 'pending' ? previous : asked;
    },
    LAST_VIEW_PENDING,
    { equals: sameLastViewed }
  );
  // The view that is opening, for the ask's span.
  const flow = useFlowTrace();
  onMount(() => {
    // Untracked: a record that settled the open since needs no answer.
    if (asks && lastViewed().status === 'pending')
      askWhileOpen(channelId, lastViewed, setAnswer, flow);
  });
  return lastViewed;
}

function laterView(
  recorded: string | null,
  asked: { viewedAt: string | null }
): string | null {
  if (asked.viewedAt === null) return recorded;
  return isLaterView(recorded, asked.viewedAt) ? asked.viewedAt : recorded;
}

/** The view a last-viewed state knows, undefined until it knows one. */
export function knownLastView(state: ChannelLastViewed) {
  return state.status === 'known' ? state.viewedAt : undefined;
}

/**
 * Whether a channel can host a call: unknown while the directory cannot tell,
 * and never in an agent DM. A channel the viewer has not joined is not one of
 * their agent DMs, so it can, as before agent DMs existed.
 */
export function useChannelCanCall(
  channelId: string
): Accessor<boolean | undefined> {
  const lookup = useChannelLookup(channelId);
  return createMemo(() => {
    const result = lookup();
    if (result.status === 'loaded') return !result.channel.agentDm;
    return result.status === 'pending' ? undefined : true;
  });
}

export function useChannelName(channelId: string, fallback?: string) {
  const channel = useChannel(channelId);
  return createMemo(() => channel()?.name ?? fallback);
}

export function useChannelType(
  channelId: string
): Accessor<DirectoryChannelType | undefined> {
  const channel = useChannel(channelId);
  return createMemo(() => channel()?.channelType);
}

/** Every member's id, people first, then bots as `bot|` principals: the
 * members a call or a DM's Work counts, as the REST list sent them. */
export function channelMemberIds(channel: DirectoryChannel): string[] {
  return [
    ...channel.participants.map(({ userId }) => userId),
    ...channel.botParticipants.map(
      ({ botId }) => `${BOT_PRINCIPAL_PREFIX}${botId}`
    ),
  ];
}

/** The person (or `bot|` principal) a DM is with, from the viewer's side. */
export function directMessagePeer(
  channel: DirectoryChannel,
  viewerId: string | undefined
): string | undefined {
  const person = channel.participants.find(({ userId }) => userId !== viewerId);
  if (person) return person.userId;
  const bot = channel.botParticipants[0];
  return bot ? `${BOT_PRINCIPAL_PREFIX}${bot.botId}` : undefined;
}

/**
 * Get a reactive map of userId -> Date for the most recent DM
 * activity with that user. Useful for ranking/sorting users by recency of
 * interaction.
 */
export function useDmActivityByUserId(): Accessor<Map<string, DateValue>> {
  const { channels } = useChannelDirectory();
  const currentUserId = useUserId();

  return createMemo(() => {
    const currentUser = currentUserId();
    if (!currentUser) return new Map();

    const map = new Map<string, DateValue>();
    for (const channel of channels()) {
      if (channel.channelType !== 'direct_message') continue;
      const peer = directMessagePeer(channel, currentUser);
      if (peer) map.set(peer, channel.updatedAt);
    }
    return map;
  });
}
