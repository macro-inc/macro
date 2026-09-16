import { useUserId } from '@core/context/user';
import {
  useCallRecordQuery,
  useSetCallRecordTeamShareMutation,
} from '@queries/call/call';
import { useCallContext } from './CallContext';

/**
 * Team sharing controls for the active call.
 *
 * `toggle` flips the call's canonical team sharing (`view` ↔ none) through
 * `PATCH /call/record/{id}` and mirrors the new value into the local call
 * store. Only the call's creator may change it, so `canToggle` is false for
 * everyone else (and while the record has not loaded yet). No-op when there's
 * no active call.
 */
export function useActiveCallTeamShare() {
  const callCtx = useCallContext();
  const userId = useUserId();
  const record = useCallRecordQuery(() => callCtx.activeCallId() ?? '');
  const mutation = useSetCallRecordTeamShareMutation();

  const canToggle = () => {
    const current = record.data;
    return (
      !!current &&
      current.callId === callCtx.activeCallId() &&
      current.createdBy === userId()
    );
  };

  const toggle = async () => {
    const callId = callCtx.activeCallId();
    if (!callId || !canToggle()) return;
    const shared = !callCtx.isSharedWithTeam();
    await mutation.mutateAsync({ callId, shared });
    callCtx.setSharedWithTeam(shared);
  };

  return { toggle, canToggle, isPending: () => mutation.isPending };
}
