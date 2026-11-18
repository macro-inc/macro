import type { ChannelEntity } from '@entity';
import { type Mutation, useMutationState } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryClient } from '../client';
import { createChannelDetailQuery } from './detail';
import {
  CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
  CHANNEL_PARTICIPANTS_MUTATION_KEY,
  type ChannelParticipantsMutationVariables,
} from './participants';
import type { ChannelParticipant } from './types';

type PendingParticipantChange = {
  kind: 'add' | 'remove';
  channelId: string;
  userIds: string[];
  submittedAt: number;
  settled: boolean;
};

function selectPendingChange(
  mutation: Mutation<unknown, Error, unknown, unknown>
): PendingParticipantChange | undefined {
  const { status, variables, submittedAt } = mutation.state;
  // A failed change shows nothing, which is its rollback.
  if (status !== 'pending' && status !== 'success') return undefined;
  const vars = variables as ChannelParticipantsMutationVariables | undefined;
  if (!vars) return undefined;
  const kind = mutation.options.mutationKey?.at(-1);
  if (kind !== 'add' && kind !== 'remove') return undefined;
  return {
    kind,
    channelId: vars.channelId,
    userIds: vars.participants,
    submittedAt,
    settled: status === 'success',
  };
}

function applyPendingChanges(
  channelId: string,
  participants: ChannelParticipant[],
  changes: readonly (PendingParticipantChange | undefined)[]
): ChannelParticipant[] {
  let result = participants;
  const now = Date.now();
  for (const change of changes) {
    if (!change || change.channelId !== channelId) continue;
    // The soup update has long arrived; a later change made elsewhere wins.
    if (
      change.settled &&
      now - change.submittedAt > CHANNEL_PARTICIPANTS_MUTATION_GC_MS
    )
      continue;
    if (change.kind === 'remove') {
      const removed = new Set(change.userIds);
      result = result.filter(
        (participant) => !removed.has(participant.user_id)
      );
      continue;
    }
    const present = new Set(result.map((participant) => participant.user_id));
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
    if (added.length) result = [...result, ...added];
  }
  return result;
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
      select: selectPendingChange,
    }),
    () => queryClient
  );
  const confirmed = createMemo(() => {
    if (query.isPending) return undefined;
    const id = channelId();
    const entity = query.data?.entities.find(
      (entity): entity is ChannelEntity =>
        entity.type === 'channel' && entity.id === id
    );
    return entity?.participants;
  });
  const data = createMemo(() => {
    const participants = confirmed();
    return participants
      ? applyPendingChanges(channelId(), participants, changes())
      : undefined;
  });
  return {
    get isPending() {
      return query.isPending;
    },
    get isLoading() {
      return query.isLoading;
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
