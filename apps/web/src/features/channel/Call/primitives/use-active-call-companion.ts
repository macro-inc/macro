import { useMeetingSessionOwnerOptional } from '@app/features/meetings/context/meeting-session-owner';
import { Telemetry } from '@macro-inc/observability';
import { useLocation, useNavigate } from '@solidjs/router';
import { useCallContextOptional } from '../CallContext';
import { getActiveMeetingPath, getMeetingShareToken } from '../call-link';
import { openChannelCallTab } from '../open-channel-call-tab';

/** Navigation and leave always use the owner of the current media session. */
export function useActiveCallCompanion() {
  const call = useCallContextOptional();
  const meetings = useMeetingSessionOwnerOptional();
  const navigate = useNavigate();
  const location = useLocation();
  const meeting = () => meetings?.forCall(call?.activeCallId() ?? null);
  const channelActive = () => {
    if (!call) return false;
    const state = call.callLifecycle.getState();
    return (
      state.t === 'active' && state.call.channelId === call.activeChannelId()
    );
  };
  const inCallView = () => {
    const active = meeting();
    if (active)
      return getMeetingShareToken(location.pathname) === active.shareToken;
    return call?.isCallPage() ?? false;
  };
  const open = async () => {
    const active = meeting();
    if (active) {
      navigate(getActiveMeetingPath(active.shareToken));
      return;
    }
    const channelId = call?.activeChannelId();
    if (channelId) await openChannelCallTab(channelId);
  };
  const canLeave = () => !!meeting() || channelActive();
  const leave = async () => {
    if (!call) return;
    const active = meeting();
    const channelId = call.activeChannelId();
    if (!active && (!channelId || !channelActive())) return;
    await Telemetry.span('call.leave', async (span) => {
      const callId = call.activeCallId();
      if (callId) span.setAttr('call.id', callId);
      let result: { callEnded: boolean } | void;
      if (active) result = await active.leave();
      else if (channelId) result = await call.callLifecycle.leave(channelId);
      else return;
      span.setAttr('call.leave.ended', result?.callEnded ?? false);
    });
  };
  return { open, canLeave, leave, inCallView };
}
