import { useUserId } from '@core/context/user';
import {
  invalidateCallRecord,
  useCallTeamShareStateQuery,
  useRespondToCallTeamShareChangeMutation,
} from '@queries/call/call';
import type { Accessor } from 'solid-js';
import { createCallEventsEffect } from './call-events';

/**
 * A call's team-sharing change awaiting approval, kept current by its
 * websocket event, and this viewer's way of answering it. Live and archived
 * calls share it.
 */
export function useCallTeamShareChange(callId: Accessor<string>) {
  const userId = useUserId();
  const state = useCallTeamShareStateQuery(callId);
  const respond = useRespondToCallTeamShareChangeMutation();

  createCallEventsEffect({
    onShareWithTeamChangeUpdated: (event) => {
      if (event.callId === callId()) invalidateCallRecord(event.callId);
    },
  });

  const pending = () =>
    state.isPending ? null : (state.data?.pending ?? null);
  const awaitsMyAnswer = () => {
    const viewer = userId();
    return !!viewer && !!pending()?.waitingOn.includes(viewer);
  };
  const isMine = () => pending()?.requestedBy === userId();

  /** Resolves to the resulting state, or nothing if saving failed. */
  const answer = async (approve: boolean) => {
    const id = callId();
    if (!id) return;
    try {
      return await respond.mutateAsync({ callId: id, approve });
    } catch {
      // The mutation already told the user; their answer can be repeated.
      return;
    }
  };

  return {
    callId,
    pending,
    awaitsMyAnswer,
    isMine,
    answer,
    isAnswering: () => respond.isPending,
  };
}

export type CallTeamShareChangeControl = ReturnType<
  typeof useCallTeamShareChange
>;
