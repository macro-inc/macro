import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import {
  type Mutation,
  useMutationState,
  useQuery,
} from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { queryClient } from '../client';
import { createChannelDetailQuery } from './detail';
import {
  CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
  CHANNEL_PARTICIPANTS_MUTATION_KEY,
  type ChannelParticipantsMutationVariables,
} from './participants';
import {
  channelParticipantsRestFallbackOptions,
  type ParticipantsFallbackReason,
  readParticipantsOnServer,
} from './participants-rest-fallback';
import type { ChannelParticipant } from './types';

type ParticipantChange = {
  id: number;
  kind: 'add' | 'remove';
  channelId: string;
  userIds: string[];
  submittedAt: number;
  settled: boolean;
};

/** What a reader remembers about a succeeded change it shows. */
type SettledChange = {
  /** The roster it succeeded over. */
  roster: string;
  /** Since when it shows. */
  since: number;
  /** Whether this reader showed it before its time to show ran out. */
  watched: boolean;
  /** Whether the server said it holds once that time ran out. */
  confirmed: boolean;
  /** People a later succeeded change here touched: that change decides them. */
  handedOff: readonly string[];
};

/** Who the server said was in a channel, asked at `at`; undefined if it did not say. */
type ServerCheck = {
  channelId: string;
  at: number;
  members: readonly string[] | undefined;
};

/** When a reader last asked the server about a channel, and what it last heard. */
type ServerState = {
  asked: { channelId: string; at: number } | undefined;
  check: ServerCheck | undefined;
};

type Fate = 'keep' | 'wait' | 'drop';

/** What one reader remembers about the changes it showed. */
type Overlay = {
  data: ChannelParticipant[] | undefined;
  /** Changes this reader saw in flight. */
  seenPending: ReadonlySet<number>;
  /** Succeeded changes still shown. */
  settled: ReadonlyMap<number, SettledChange>;
  /** Succeeded changes a newer record has superseded; never shown again. */
  superseded: ReadonlySet<number>;
  /** When the next succeeded change's time to show runs out. */
  expiresAt: number | undefined;
};

const EMPTY_OVERLAY: Overlay = {
  data: undefined,
  seenPending: new Set(),
  settled: new Map(),
  superseded: new Set(),
  expiresAt: undefined,
};

function selectChange(
  mutation: Mutation<unknown, Error, unknown, unknown>
): ParticipantChange | undefined {
  const { status, variables, submittedAt } = mutation.state;
  // A failed change shows nothing, which is its rollback.
  if (status !== 'pending' && status !== 'success') return undefined;
  const vars = variables as ChannelParticipantsMutationVariables | undefined;
  if (!vars) return undefined;
  const kind = mutation.options.mutationKey?.at(-1);
  if (kind !== 'add' && kind !== 'remove') return undefined;
  return {
    id: mutation.mutationId,
    kind,
    channelId: vars.channelId,
    userIds: vars.participants,
    submittedAt,
    settled: status === 'success',
  };
}

function rosterOf(participants: readonly ChannelParticipant[]) {
  return participants
    .map((participant) => participant.user_id)
    .sort()
    .join('\n');
}

function recordShows(
  change: ParticipantChange,
  participants: readonly ChannelParticipant[]
) {
  return holdsIn(
    change,
    new Set(participants.map((participant) => participant.user_id))
  );
}

function holdsIn(change: ParticipantChange, present: ReadonlySet<string>) {
  return change.kind === 'add'
    ? change.userIds.every((userId) => present.has(userId))
    : change.userIds.every((userId) => !present.has(userId));
}

function applyChange(
  channelId: string,
  participants: ChannelParticipant[],
  change: ParticipantChange
): ChannelParticipant[] {
  if (change.kind === 'remove') {
    const removed = new Set(change.userIds);
    return participants.filter(
      (participant) => !removed.has(participant.user_id)
    );
  }
  const present = new Set(
    participants.map((participant) => participant.user_id)
  );
  const joinedAt = new Date(change.submittedAt).toISOString();
  const added = change.userIds
    .filter((userId) => !present.has(userId))
    .map(
      (userId): ChannelParticipant => ({
        channel_id: channelId,
        user_id: userId,
        role: 'member',
        joined_at: joinedAt,
        left_at: null,
      })
    );
  return added.length ? [...participants, ...added] : participants;
}

// A later add or remove of the same people that succeeded decides what they
// show as, even once it settles against a record that already matched it. One
// still in flight shows over this change, which comes back if it fails.
function handedOff(
  change: ParticipantChange,
  changes: readonly (ParticipantChange | undefined)[],
  earlier: readonly string[]
): readonly string[] {
  const touched = new Set(earlier);
  for (const later of changes) {
    if (!later?.settled || later.id <= change.id) continue;
    if (later.channelId !== change.channelId) continue;
    for (const userId of later.userIds)
      if (change.userIds.includes(userId)) touched.add(userId);
  }
  return touched.size === earlier.length ? earlier : [...touched];
}

/** The part of a change still its own to show. */
function stillShown(
  change: ParticipantChange,
  handed: readonly string[]
): ParticipantChange {
  if (!handed.length) return change;
  return {
    ...change,
    userIds: change.userIds.filter((userId) => !handed.includes(userId)),
  };
}

/** Keeps the answer to the later question when two checks answer out of order. */
function newestCheck(last: ServerCheck | undefined, next: ServerCheck) {
  return last?.channelId === next.channelId && last.at > next.at ? last : next;
}

/** How long a channel's first by-id read may go unanswered before its reader asks REST too. */
export const CHANNEL_READ_SLOW_MS = 3_000;

function fallbackReason(
  failed: boolean,
  slow: boolean
): ParticipantsFallbackReason {
  if (failed) return 'channel read failed';
  return slow ? 'channel read slow' : 'channel not in soup';
}

/** Asks the server who is in the channel at `at`, once a change's time to show ran out. */
async function askServer(
  channelId: string,
  at: number,
  answered: (check: ServerCheck) => void
) {
  let members: readonly string[] | undefined;
  try {
    members = await readParticipantsOnServer(channelId);
  } finally {
    // Even a read that threw is an answer: the change stops waiting on it.
    answered({ channelId, at, members });
  }
}

/**
 * Whether a succeeded change keeps showing once its time to show has run out:
 * only if this reader showed it all that time, and the server's latest answer
 * asked since then says it still holds. Until the server answers, it waits; a
 * failed answer drops it, unless an earlier one confirmed it.
 */
function outlives(
  change: ParticipantChange,
  seen: SettledChange,
  expires: number,
  check: ServerCheck | undefined
): Fate {
  if (!seen.watched) return 'drop';
  const answer = check && check.at >= expires ? check : undefined;
  if (answer?.members)
    return holdsIn(change, new Set(answer.members)) ? 'keep' : 'drop';
  if (seen.confirmed) return 'keep';
  return answer ? 'drop' : 'wait';
}

/** How a reader first records a succeeded change it shows. */
function firstSeen(
  change: ParticipantChange,
  previous: Overlay,
  roster: string,
  now: number
): SettledChange {
  // A reader opened after the change succeeded times it from its submission.
  const since = previous.seenPending.has(change.id) ? now : change.submittedAt;
  return {
    roster,
    since,
    watched: now < since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
    confirmed: false,
    handedOff: [],
  };
}

/** Carries what a reader remembers about one change into its next overlay. */
function keepHistory(
  id: number,
  previous: Overlay,
  next: {
    seenPending: Set<number>;
    settled: Map<number, SettledChange>;
    superseded: Set<number>;
  }
) {
  if (previous.seenPending.has(id)) next.seenPending.add(id);
  if (previous.superseded.has(id)) next.superseded.add(id);
  const earlier = previous.settled.get(id);
  if (earlier) next.settled.set(id, earlier);
}

/** What a reader judges a succeeded change against. */
type SettledContext = {
  changes: readonly (ParticipantChange | undefined)[];
  participants: readonly ChannelParticipant[];
  roster: string;
  previous: Overlay;
  now: number;
  check: ServerCheck | undefined;
  askedAt: number | undefined;
};

/**
 * Whether a succeeded change still shows, and how: undefined once something
 * has superseded it; else what the reader remembers, the people it shows for,
 * and when it next needs a question asked.
 */
function judgeSettled(
  change: ParticipantChange,
  context: SettledContext
):
  | {
      seen: SettledChange;
      shown: ParticipantChange;
      timeAt: number | undefined;
    }
  | undefined {
  const { previous, now } = context;
  if (previous.superseded.has(change.id)) return undefined;
  const seen =
    previous.settled.get(change.id) ??
    firstSeen(change, previous, context.roster, now);
  const handed = handedOff(change, context.changes, seen.handedOff);
  const shown = stillShown(change, handed);
  const expires = seen.since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS;
  const fate: Fate =
    now < expires ? 'keep' : outlives(shown, seen, expires, context.check);
  if (
    seen.roster !== context.roster ||
    !shown.userIds.length ||
    recordShows(shown, context.participants) ||
    fate === 'drop'
  )
    return undefined;
  // Time the next question: a confirmed change shows until the record catches
  // up, and one waiting on a question already asked has nothing to time.
  const asked = context.askedAt !== undefined && context.askedAt >= expires;
  return {
    seen: {
      ...seen,
      handedOff: handed,
      confirmed: seen.confirmed || (now >= expires && fate === 'keep'),
    },
    shown,
    timeAt: now < expires || (fate === 'wait' && !asked) ? expires : undefined,
  };
}

/**
 * Shows the channel's adds and removes over its record: in flight, and once
 * they succeed until the record shows them, the record changes otherwise
 * (someone changed it since), a later change here succeeds for the same people,
 * or the change has shown for a while without its soup update arriving and the
 * server, asked then (`server`), does not say it still holds.
 */
export function overlayParticipantChanges(
  channelId: string,
  participants: ChannelParticipant[] | undefined,
  changes: readonly (ParticipantChange | undefined)[],
  previous: Overlay,
  now: number,
  server?: ServerState
): Overlay {
  if (!participants)
    return { ...previous, data: undefined, expiresAt: undefined };
  const roster = rosterOf(participants);
  const seenPending = new Set<number>();
  const settled = new Map<number, SettledChange>();
  const superseded = new Set<number>();
  let expiresAt: number | undefined;
  let data = participants;
  const own = <T extends { channelId: string }>(value: T | undefined) =>
    value?.channelId === channelId ? value : undefined;
  const check = own(server?.check);
  const askedAt = own(server?.asked)?.at;
  for (const change of changes) {
    if (!change) continue;
    if (change.channelId !== channelId) {
      // Kept for when the reader returns to that channel.
      keepHistory(change.id, previous, { seenPending, settled, superseded });
      continue;
    }
    if (!change.settled) {
      seenPending.add(change.id);
      data = applyChange(channelId, data, change);
      continue;
    }
    const judged = judgeSettled(change, {
      changes,
      participants,
      roster,
      previous,
      now,
      check,
      askedAt,
    });
    if (!judged) {
      superseded.add(change.id);
      continue;
    }
    settled.set(change.id, judged.seen);
    if (judged.timeAt !== undefined)
      expiresAt = Math.min(expiresAt ?? judged.timeAt, judged.timeAt);
    data = applyChange(channelId, data, judged.shown);
  }
  return { data, seenPending, settled, superseded, expiresAt };
}

/**
 * The active participants of a channel, from its GraphQL soup record. Shares
 * the open channel's by-id request and stays current through soup updates.
 * Adds and removes in flight show until the record catches up.
 */
export function useChannelParticipantsQuery(channelId: Accessor<string>) {
  // The id alone, so timers below restart only when it changes.
  const openId = createMemo(() => channelId());
  const query = createChannelDetailQuery(
    channelId,
    () => !!channelId(),
    'cache-first'
  );
  const changes = useMutationState(
    () => ({
      filters: { mutationKey: CHANNEL_PARTICIPANTS_MUTATION_KEY },
      select: selectChange,
    }),
    () => queryClient
  );
  // What the channel's by-id read last answered for the open channel.
  const answered = createMemo<
    { channelId: string; hasChannel: boolean } | undefined
  >((previous) => {
    if (query.isPending) return undefined;
    const id = channelId();
    if (query.error) return previous?.channelId === id ? previous : undefined;
    const hasChannel = !!query.data?.entities.some(
      (entity) => entity.type === 'channel' && entity.id === id
    );
    return { channelId: id, hasChannel };
  });
  // The soup read leaves out public channels the viewer has not joined, which
  // REST lets them read, so a read that answered without the channel asks
  // REST, and keeps asking through failed refreshes. So does a read that
  // failed before it ever answered, since nothing retries it; REST checks
  // access itself, as it did when it was the only reader. A failed refresh of
  // a channel the read returned keeps its roster (see `confirmed`).
  // A first read still unanswered after a while asks REST too, as main's
  // reader did on every open: the channel's by-id read can wait behind a busy
  // cache or connection long after REST would have answered.
  const [slowChannel, setSlowChannel] = createSignal<string>();
  const pendingChannel = createMemo(() =>
    query.isPending ? openId() || undefined : undefined
  );
  createEffect(
    on(pendingChannel, (pending) => {
      setSlowChannel(undefined);
      if (!pending) return;
      const timer = setTimeout(
        () => setSlowChannel(pending),
        CHANNEL_READ_SLOW_MS
      );
      onCleanup(() => clearTimeout(timer));
    })
  );
  const readSlow = () => query.isPending && slowChannel() === openId();
  const missesChannel = () => {
    if (!channelId()) return false;
    if (query.isPending) return readSlow();
    return answered()?.hasChannel !== true;
  };
  const fallback = useQuery(() =>
    channelParticipantsRestFallbackOptions(
      channelId(),
      missesChannel(),
      fallbackReason(!!query.error, readSlow())
    )
  );
  const confirmed = createMemo<
    | { channelId: string; participants: ChannelParticipant[] | undefined }
    | undefined
  >((previous) => {
    if (query.isPending && !readSlow()) return undefined;
    const id = channelId();
    if (missesChannel()) {
      // A failed REST refetch keeps its last participants. Rows still from the
      // previous channel's REST read never show for this one.
      const rows = fallback.isPending ? undefined : fallback.data;
      const own = rows?.every(
        (participant) =>
          participant.channel_id.toLowerCase() === id.toLowerCase()
      );
      return { channelId: id, participants: own ? rows : undefined };
    }
    // A failed refresh keeps the participants on screen.
    if (query.error)
      return previous?.channelId === id
        ? previous
        : { channelId: id, participants: undefined };
    const entity = query.data?.entities.find(
      (entity): entity is ChannelEntity =>
        entity.type === 'channel' && entity.id === id
    );
    return { channelId: id, participants: entity?.participants };
  });
  // Ticks when a succeeded change's time to show runs out.
  const [tick, setTick] = createSignal(0);
  // When the reader last asked the server about its channel, once a succeeded
  // change's time to show ran out, and the latest answer.
  const [asked, setAsked] = createSignal<ServerState['asked']>();
  const [check, setCheck] = createSignal<ServerCheck>();
  const answeredCheck = (next: ServerCheck) =>
    setCheck((last) => newestCheck(last, next));
  const overlay = createMemo<Overlay>((previous) => {
    tick();
    return overlayParticipantChanges(
      channelId(),
      confirmed()?.participants,
      changes(),
      previous,
      Date.now(),
      { asked: asked(), check: check() }
    );
  }, EMPTY_OVERLAY);
  // When a succeeded change's time to show runs out, the reader asks the
  // server whether it holds, and shows it until the server answers. (A memo, so
  // a recomputed overlay with the same expiry neither restarts the timer nor
  // asks again.)
  const expiresAt = createMemo(() => overlay().expiresAt);
  createEffect(
    on([openId, expiresAt], ([current, expires]) => {
      if (expires === undefined) return;
      const timer = setTimeout(
        () => {
          const at = Math.max(Date.now(), expires);
          batch(() => {
            setAsked({ channelId: current, at });
            setTick((value) => value + 1);
          });
          fireAndForget(
            askServer(current, at, answeredCheck),
            'channel participants server check'
          );
        },
        Math.max(0, expires - Date.now())
      );
      onCleanup(() => clearTimeout(timer));
    })
  );
  const data = () => overlay().data;
  return {
    get isPending() {
      return (
        (query.isPending && !readSlow()) ||
        (missesChannel() && fallback.isPending)
      );
    },
    get isLoading() {
      return (
        (query.isLoading && !readSlow()) ||
        (missesChannel() && fallback.isLoading)
      );
    },
    /** The channel's record arrived; a channel the viewer can't read has none. */
    get isSuccess() {
      return (!query.isPending || readSlow()) && data() !== undefined;
    },
    get data() {
      return data();
    },
  };
}
