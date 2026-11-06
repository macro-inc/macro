import type { JSX } from 'solid-js';
import { useCallContext } from '../CallContext';
import { LK_TRACK_SOURCE } from '../livekit-loader';
import { CallMediaControls } from './CallMediaControls';

export function CallControlsDefaultAndPanelRow(props: {
  onLeave: () => void | Promise<void>;
  onSettingsOpenChange?: (open: boolean) => void;
  children?: JSX.Element;
}) {
  const call = useCallContext();
  const screenUnavailable = () => {
    call.trackVersion();
    if (call.isScreenSharing()) return false;
    return Array.from(call.remoteParticipants().values()).some(
      (participant) => {
        const publication = participant.getTrackPublication(
          LK_TRACK_SOURCE.ScreenShare
        );
        return (
          !!publication?.track &&
          publication.isSubscribed &&
          !publication.isMuted
        );
      }
    );
  };
  return (
    <CallMediaControls
      media={call}
      screenUnavailable={screenUnavailable()}
      onLeave={props.onLeave}
      onSettingsOpenChange={props.onSettingsOpenChange}
    >
      {props.children}
    </CallMediaControls>
  );
}
