import { useMeetingSessionOwnerOptional } from '@app/features/meetings/context/meeting-session-owner';
import { beginInteraction } from '@app/observability/flow';
import { globalSplitManager } from '@app/signal/splitLayout';
import { Telemetry } from '@macro-inc/observability';
import { useLocation, useNavigate } from '@solidjs/router';
import { useCallContextOptional } from '../CallContext';
import { getActiveMeetingPath, getMeetingShareToken } from '../call-link';
import { meetingCallIdOfNativeCallKey } from '../native-call-key';
import { useMaybeNativeCallState } from '../native-call-state';
import { openChannelCallTab } from '../open-channel-call-tab';

/** Navigation and leave always use the owner of the current media session. */
export function useActiveCallCompanion() {
  const call = useCallContextOptional();
  const meetings = useMeetingSessionOwnerOptional();
  const navigate = useNavigate();
  const location = useLocation();
  const meeting = () => meetings?.forCall(call?.activeCallId() ?? null);
  // A native meeting call outlives its page when the web view reloads; with
  // no session to own it, Leave still ends it.
  const nativeCall = useMaybeNativeCallState();
  const orphanedNativeMeeting = () => {
    const key = nativeCall?.activeChannelId();
    const callId = key ? meetingCallIdOfNativeCallKey(key) : undefined;
    if (!callId || meeting()) return false;
    // A meeting still joining owns the call before it reports it.
    return !meetings?.isJoining(callId);
  };
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
  const inChannel = () => {
    if (meeting()) return false;
    const channelId = call?.activeChannelId();
    if (!channelId) return false;
    const content = globalSplitManager()?.activeSplit()?.content();
    return content?.type === 'channel' && content.id === channelId;
  };
  const open = async () => {
    const interaction = beginInteraction('call.return', {
      attributes: { 'call.id': call?.activeCallId() ?? '' },
      closeOnJoin: true,
    });
    try {
      const active = meeting();
      if (active) {
        navigate(getActiveMeetingPath(active.shareToken));
        return;
      }
      const channelId = call?.activeChannelId();
      if (channelId) await openChannelCallTab(channelId);
    } finally {
      interaction.end();
    }
  };
  const canLeave = () =>
    !!meeting() || channelActive() || orphanedNativeMeeting();
  const leave = async () => {
    if (!call) return;
    const orphaned = orphanedNativeMeeting();
    const active = meeting();
    const channelId = call.activeChannelId();
    if (!orphaned && !active && (!channelId || !channelActive())) return;
    await Telemetry.span('call.leave', async (span) => {
      const callId = call.activeCallId();
      if (callId) span.setAttr('call.id', callId);
      span.setAttr('call.leave.orphaned', orphaned);
      let result: { callEnded: boolean } | void = undefined;
      if (orphaned) await call.meetingSession.disconnect();
      else if (active) result = await active.leave();
      else if (channelId) result = await call.callLifecycle.leave(channelId);
      else return;
      span.setAttr('call.leave.ended', result?.callEnded ?? false);
    });
  };
  return { open, canLeave, leave, inCallView, inChannel };
}
