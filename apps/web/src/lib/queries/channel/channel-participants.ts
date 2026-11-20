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
import { channelParticipantsRestFallbackOptions } from './participants-rest-fallback';
import type { ChannelParticipant } from './types';

type ParticipantChange = {
  id: number;
  kind: 'add' | 'remove';
  channelId: string;
  userIds: string[];
  submittedAt: number;
  settled: boolean;
};

/** What one reader remembers about the changes it showed. */
type Overlay = {
  data: ChannelParticipant[] | undefined;
  /** Changes this reader saw in flight. */
  seenPending: ReadonlySet<number>;
  /** Succeeded changes still shown: the roster they succeeded over, and since when. */
  settled: ReadonlyMap<number, { roster: string; since: number }>;
  /** Succeeded changes a newer record has superseded; never shown again. */
  superseded: ReadonlySet<number>;
  /** When the next succeeded change stops showing. */
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
  const present = new Set(
    participants.map((participant) => participant.user_id)
  );
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

/**
 * Shows the channel's adds and removes over its record: in flight, and once
 * they succeed until the record shows them, the record changes otherwise
 * (someone changed it since), a later change here touches the same people, or
 * the change has shown for a while without its soup update arriving.
 */
export function overlayParticipantChanges(
  channelId: string,
  participants: ChannelParticipant[] | undefined,
  changes: readonly (ParticipantChange | undefined)[],
  previous: Overlay,
  now: number
): Overlay {
  if (!participants)
    return { ...previous, data: undefined, expiresAt: undefined };
  const roster = rosterOf(participants);
  const seenPending = new Set<number>();
  const settled = new Map<number, { roster: string; since: number }>();
  const superseded = new Set<number>();
  let expiresAt: number | undefined;
  let data = participants;
  for (const change of changes) {
    if (!change || change.channelId !== channelId) continue;
    if (!change.settled) {
      seenPending.add(change.id);
      data = applyChange(channelId, data, change);
      continue;
    }
    const seen = previous.settled.get(change.id) ?? {
      roster,
      // A reader opened after the change succeeded times it from its submission.
      since: previous.seenPending.has(change.id) ? now : change.submittedAt,
    };
    const expires = seen.since + CHANNEL_PARTICIPANTS_MUTATION_GC_MS;
    if (
      previous.superseded.has(change.id) ||
      seen.roster !== roster ||
      recordShows(change, participants) ||
      laterChangeTouches(change, changes) ||
      now >= expires
    ) {
      superseded.add(change.id);
      continue;
    }
    settled.set(change.id, seen);
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
  // The channel whose by-id read last answered without an error.
  const answered = createMemo<string | undefined>((previous) => {
    const id = channelId();
    if (query.isPending || query.error)
      return previous === id ? previous : undefined;
    return id;
  });
  // The soup read leaves out public channels the viewer has not joined, which
  // REST lets them read, so a by-id read that came back without the channel
  // asks REST. So does one that failed before it ever answered, since nothing
  // retries a failed read; only a later revalidation reads it again. A failed
  // refresh keeps what the read answered (see `confirmed`).
  const missesChannel = () => {
    const id = channelId();
    if (!id || query.isPending) return false;
    if (query.error) return answered() !== id;
    return !query.data?.entities.some(
      (entity) => entity.type === 'channel' && entity.id === id
    );
  };
  const fallback = useQuery(() =>
    channelParticipantsRestFallbackOptions(channelId(), missesChannel())
  );
  const confirmed = createMemo<
    | { channelId: string; participants: ChannelParticipant[] | undefined }
    | undefined
  >((previous) => {
    if (query.isPending) return undefined;
    const id = channelId();
    // A failed refresh keeps the participants on screen.
    if (
      query.error &&
      previous?.channelId === id &&
      previous.participants !== undefined
    )
      return previous;
    const entity = query.data?.entities.find(
      (entity): entity is ChannelEntity =>
        entity.type === 'channel' && entity.id === id
    );
    if (entity) return { channelId: id, participants: entity.participants };
    // A failed REST refetch keeps its last participants.
    const fromRest =
      missesChannel() && !fallback.isPending ? fallback.data : undefined;
    return { channelId: id, participants: fromRest };
  });
  // Ticks when a succeeded change's time to show runs out.
  const [tick, setTick] = createSignal(0);
  const overlay = createMemo<Overlay>((previous) => {
    tick();
    return overlayParticipantChanges(
      channelId(),
      confirmed()?.participants,
      changes(),
      previous,
      Date.now()
    );
  }, EMPTY_OVERLAY);
  createEffect(
    on(
      () => overlay().expiresAt,
      (expiresAt) => {
        if (expiresAt === undefined) return;
        const timer = setTimeout(
          () => setTick((value) => value + 1),
          Math.max(0, expiresAt - Date.now())
        );
        onCleanup(() => clearTimeout(timer));
      }
    )
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
