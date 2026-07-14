import { createMemo } from 'solid-js';
import { useCallContext } from '../CallContext';
import { useCall } from '../use-call';
import {
  debugInCallExtraRemoteMembers,
  readInCallPanelDebugExtraRemoteCount,
} from './in-call-panel-debug';
import {
  buildOrderedInCallMembers,
  buildVisibleAvatarSlots,
  IN_CALL_PANEL_VISIBLE_AVATAR_COUNT,
  splitInCallMembersForAvatars,
} from './members';
import type { UseInCallPanelOptions, UseInCallPanelResult } from './types';

/**
 * Headless model for the in-call sidebar strip: participant split + the same
 * control surface as `CallOverlay` (mic / cam / screen / leave + device switches).
 *
 * Dev: `?in_call_debug_extra=8` appends fake remotes for crowded-roster UI (see `inCallPanelDebug.ts`;
 * values are clamped to a max in that module).
 */
export function useInCallPanel(
  options?: UseInCallPanelOptions
): UseInCallPanelResult {
  const callCtx = useCallContext();

  const resolvedChannelId = () =>
    options?.channelId?.() ?? callCtx.activeChannelId() ?? '';

  const call = useCall(resolvedChannelId, {
    onJoin: options?.onJoinCall,
    onLeave: options?.onLeaveCall,
  });

  const members = createMemo(() => {
    const real = buildOrderedInCallMembers(
      callCtx.room(),
      callCtx.remoteParticipants()
    );
    const extra = readInCallPanelDebugExtraRemoteCount();
    if (extra === 0) return real;
    return [...real, ...debugInCallExtraRemoteMembers(extra)];
  });

  const avatarSplit = createMemo(() =>
    splitInCallMembersForAvatars(members(), IN_CALL_PANEL_VISIBLE_AVATAR_COUNT)
  );

  const isActive = () => {
    if (!callCtx.isInCall()) return false;
    if (options?.channelId === undefined) return true;
    return callCtx.activeChannelId() === options.channelId();
  };

  const avatarSlotsRow = createMemo(() =>
    buildVisibleAvatarSlots(
      isActive(),
      members(),
      IN_CALL_PANEL_VISIBLE_AVATAR_COUNT
    )
  );

  const controls = {
    toggleAudio: () => callCtx.toggleAudio(),
    toggleVideo: () => callCtx.toggleVideo(),
    toggleScreenShare: () => callCtx.toggleScreenShare(),
    leaveCall: () => call.leaveCall(),
    switchAudioInput: (deviceId: string) => callCtx.switchAudioInput(deviceId),
    switchAudioOutput: (deviceId: string) =>
      callCtx.switchAudioOutput(deviceId),
    switchVideoInput: (deviceId: string) => callCtx.switchVideoInput(deviceId),
  };

  return {
    isActive,
    visibleMembers: () => avatarSplit().visible,
    visibleAvatarSlots: () => avatarSlotsRow(),
    overflowMembers: () => avatarSplit().overflow,
    isConnecting: callCtx.isConnecting,
    callCtx,
    controls,
  };
}
