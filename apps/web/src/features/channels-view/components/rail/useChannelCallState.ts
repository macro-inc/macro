import { useVisibleIncomingCalls } from '@app/features/block-call/sidebar/incoming-calls';
import { useActiveCallsQuery } from '@queries/call/call';
import { createMemo } from 'solid-js';
import type { ChannelCallStatus } from './ChannelRailItems';

export function useChannelCallState() {
  const activeCallsQuery = useActiveCallsQuery();
  const incomingCalls = useVisibleIncomingCalls();
  const callActivity = createMemo(() => {
    const calls = new Map<
      string,
      {
        callId: string;
        channelId: string;
        status: ChannelCallStatus;
      }
    >();

    for (const call of incomingCalls()) {
      calls.set(call.callId, { ...call, status: 'incoming' });
    }
    for (const call of activeCallsQuery.data ?? []) {
      if (calls.has(call.callId)) continue;

      calls.set(call.callId, { ...call, status: 'active' });
    }

    return [...calls.values()];
  });
  const incomingCallIds = createMemo(
    () =>
      new Map(
        incomingCalls().map((call) => [call.channelId, call.callId] as const)
      )
  );
  const callStatuses = createMemo(() => {
    const statuses = new Map<string, ChannelCallStatus>();

    for (const call of activeCallsQuery.data ?? []) {
      statuses.set(call.channelId, 'active');
    }
    for (const call of incomingCalls()) {
      statuses.set(call.channelId, 'incoming');
    }

    return statuses;
  });

  return { callActivity, incomingCallIds, callStatuses };
}
