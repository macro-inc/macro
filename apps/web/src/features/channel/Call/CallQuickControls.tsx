import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import PhoneDisconnect from '@icon/system/regular/phone-disconnect.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Telemetry } from '@macro-inc/observability';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

type QuickControl = 'camera' | 'screen' | 'sharing';

/** Compact surfaces reuse the same media owner; no second room or device capture. */
export function CallQuickControls(props: {
  controls: readonly QuickControl[];
  channelName?: string;
}) {
  const call = useCallContext();
  const sharing = useActiveCallTeamShare();
  const screenUnavailable = () => {
    call.trackVersion();
    return (
      !call.isScreenSharing() &&
      Array.from(call.remoteParticipants().values()).some((participant) => {
        const publication = participant.getTrackPublication(
          LK_TRACK_SOURCE.ScreenShare
        );
        return (
          !!publication?.track &&
          publication.isSubscribed &&
          !publication.isMuted
        );
      })
    );
  };
  const leave = async () => {
    const channelId = call.activeChannelId();
    if (!channelId) return;
    await Telemetry.span('call.leave', async (span) => {
      const callId = call.activeCallId();
      if (callId) span.setAttr('call.id', callId);
      const result = await call.callLifecycle.leave(channelId);
      span.setAttr('call.leave.ended', result?.callEnded ?? false);
    });
  };
  return (
    <div class="flex items-center gap-1.5 p-2">
      <Button
        variant="secondary"
        size="icon-md"
        aria-label={
          call.isAudioMuted()
            ? t('calls.microphoneOn')
            : t('calls.microphoneOff')
        }
        disabled={call.isConnecting()}
        onClick={() => fireAndForget(call.toggleAudio(), 'call-quick-controls')}
      >
        <Show
          when={call.isAudioMuted()}
          fallback={<Microphone class="size-4" />}
        >
          <MicrophoneSlash class="size-4 text-failure" />
        </Show>
      </Button>
      <Show when={props.controls.includes('camera')}>
        <Button
          variant="secondary"
          size="icon-md"
          aria-label={
            call.isVideoMuted() ? t('calls.cameraOn') : t('calls.cameraOff')
          }
          disabled={call.isConnecting()}
          onClick={() =>
            fireAndForget(call.toggleVideo(), 'call-quick-controls')
          }
        >
          <Show
            when={call.isVideoMuted()}
            fallback={<VideoCamera class="size-4" />}
          >
            <VideoCameraSlash class="size-4 text-failure" />
          </Show>
        </Button>
      </Show>
      <Show when={props.controls.includes('screen')}>
        <Button
          variant={call.isScreenSharing() ? 'accent' : 'secondary'}
          size="icon-md"
          aria-label={t('calls.shareScreenTitle')}
          disabled={call.isConnecting() || screenUnavailable()}
          onClick={() =>
            fireAndForget(call.toggleScreenShare(), 'call-quick-controls')
          }
        >
          <Screencast class="size-4" />
        </Button>
      </Show>
      <Show when={props.controls.includes('sharing') && sharing.canToggle()}>
        <CallSharingMenu
          size="md"
          channelName={props.channelName}
          sharedWithTeam={call.isSharedWithTeam()}
          disabled={call.isConnecting() || sharing.isPending()}
          onToggle={() =>
            fireAndForget(sharing.toggle(), 'call-quick-controls')
          }
          onOpenChange={() => {}}
        />
      </Show>
      <span class="flex-1" />
      <Show when={call.activeChannelId()}>
        <Button
          variant="danger"
          size="icon-md"
          class="min-w-11"
          aria-label={t('calls.leave')}
          onClick={() => fireAndForget(leave(), 'call-quick-controls')}
        >
          <PhoneDisconnect class="size-4" />
        </Button>
      </Show>
    </div>
  );
}
