import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import {
  type Mutation,
  useMutationState,
  useQuery,
} from '@tanstack/solid-query';
import {
  type Accessor,
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
};

/** Who the server said was in a channel, asked at `at`; undefined if it did not say. */
type ServerCheck = {
  channelId: string;
  at: number;
  members: readonly string[] | undefined;
};

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

// A later add or remove of the same people decides what they show as, even once
// it settles against a record that already matched it.
function laterChangeTouches(
  change: ParticipantChange,
  changes: readonly (ParticipantChange | undefined)[]
) {
  const userIds = new Set(change.userIds);
  return changes.some(
    (later) =>
      !!later &&
      later.id > change.id &&
      later.channelId === change.channelId &&
      later.userIds.some((userId) => userIds.has(userId))
  );
}

/** Asks the server who is in the channel, once a change's time to show ran out at `expires`. */
async function askServer(
  channelId: string,
  expires: number,
  answered: (check: ServerCheck) => void
) {
  const at = Math.max(Date.now(), expires);
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
 * only if this reader showed it all that time, and the server, asked since
 * then, says it still holds. Until the server answers, it waits.
 */
function outlives(
  change: ParticipantChange,
  seen: SettledChange,
  expires: number,
  check: ServerCheck | undefined
): 'keep' | 'wait' | 'drop' {
  if (seen.confirmed) return 'keep';
  if (!seen.watched) return 'drop';
  if (!check || check.at < expires) return 'wait';
  return check.members && holdsIn(change, new Set(check.members))
    ? 'keep'
    : 'drop';
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

/**
 * Shows the channel's adds and removes over its record: in flight, and once
 * they succeed until the record shows them, the record changes otherwise
 * (someone changed it since), a later change here touches the same people, or
 * the change has shown for a while without its soup update arriving and the
 * server, asked then (`check`), does not say it still holds.
 */
export function overlayParticipantChanges(
  channelId: string,
  participants: ChannelParticipant[] | undefined,
  changes: readonly (ParticipantChange | undefined)[],
  previous: Overlay,
  now: number,
  check?: ServerCheck
): Overlay {
  if (!participants)
    return { ...previous, data: undefined, expiresAt: undefined };
  const roster = rosterOf(participants);
  const seenPending = new Set<number>();
  const settled = new Map<number, SettledChange>();
  const superseded = new Set<number>();
  let expiresAt: number | undefined;
  let data = participants;
  const ownCheck = check?.channelId === channelId ? check : undefined;
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
    const seen =
      previous.settled.get(change.id) ??
      firstSeen(change, previous, roster, now);
    const expires = seen.since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS;
    const fate =
      now < expires ? 'keep' : outlives(change, seen, expires, ownCheck);
    if (
      previous.superseded.has(change.id) ||
      seen.roster !== roster ||
      recordShows(change, participants) ||
      laterChangeTouches(change, changes) ||
      fate === 'drop'
    ) {
      superseded.add(change.id);
      continue;
    }
    settled.set(
      change.id,
      now >= expires && fate === 'keep' ? { ...seen, confirmed: true } : seen
    );
    // A confirmed change shows until the record catches up; nothing to time.
    if (now < expires || fate === 'wait')
      expiresAt = Math.min(expiresAt ?? expires, expires);
    data = applyChange(channelId, data, change);
  }
  return { data, seenPending, settled, superseded, expiresAt };
}

/**
 * The active participants of a channel, from its GraphQL soup record. Shares
 * the open channel's by-id request and stays current through soup updates.
 * Adds and removes in flight show until the record catches up.
 */
export function useChannelParticipantsQuery(channelId: Accessor<string>) {
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
  const missesChannel = () => {
    if (!channelId() || query.isPending) return false;
    return answered()?.hasChannel !== true;
  };
  const fallback = useQuery(() =>
    channelParticipantsRestFallbackOptions(
      channelId(),
      missesChannel(),
      query.error ? 'channel read failed' : 'channel not in soup'
    )
  );
  const confirmed = createMemo<
    | { channelId: string; participants: ChannelParticipant[] | undefined }
    | undefined
  >((previous) => {
    if (query.isPending) return undefined;
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
  // What the server last said about this reader's channel, once a succeeded
  // change's time to show ran out.
  const [check, setCheck] = createSignal<ServerCheck>();
  const overlay = createMemo<Overlay>((previous) => {
    tick();
    return overlayParticipantChanges(
      channelId(),
      confirmed()?.participants,
      changes(),
      previous,
      Date.now(),
      check()
    );
  }, EMPTY_OVERLAY);
  // When a succeeded change's time to show runs out, the reader asks the
  // server whether it holds, and shows it until the server answers. (A memo, so
  // a recomputed overlay with the same expiry neither restarts the timer nor
  // asks again.)
  const expiresAt = createMemo(() => overlay().expiresAt);
  createEffect(
    on([channelId, expiresAt], ([id, expires]) => {
      if (expires === undefined) return;
      const timer = setTimeout(
        () => {
          setTick((value) => value + 1);
          fireAndForget(
            askServer(id, expires, setCheck),
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
      return query.isPending || (missesChannel() && fallback.isPending);
    },
    get isLoading() {
      return query.isLoading || (missesChannel() && fallback.isLoading);
    },
    /** The channel's record arrived; a channel the viewer can't read has none. */
    get isSuccess() {
      return !query.isPending && data() !== undefined;
    },
    get data() {
      return data();
    },
  };
}
