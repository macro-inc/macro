import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import Microphone from '@icon/system/regular/microphone.svg';
import MicrophoneSlash from '@icon/system/regular/microphone-slash.svg';
import PhoneDisconnect from '@icon/system/regular/phone-disconnect.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import VideoCamera from '@icon/system/regular/video-camera.svg';
import VideoCameraSlash from '@icon/system/regular/video-camera-slash.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallMediaControls } from './CallControls/CallMediaControls';
import { CallReactionMenu } from './CallControls/CallReactionMenu';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import type { CallReactionEmoji } from './call-reactions';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { useActiveCallCompanion } from './use-active-call-companion';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

type QuickControl = 'camera' | 'screen' | 'sharing';

/** Compact surfaces reuse the same media owner; no second room or device capture. */
export function CallQuickControls(props: {
  controls: readonly QuickControl[];
  size?: 'icon-md' | 'icon-lg';
  channelName?: string;
  settings?: boolean;
  onReaction?: (emoji: CallReactionEmoji) => void;
}) {
  const call = useCallContext();
  const sharing = useActiveCallTeamShare();
  const companion = useActiveCallCompanion();
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
  const SharingControl = () => (
    <Show when={props.controls.includes('sharing') && sharing.canToggle()}>
      <CallSharingMenu
        size="md"
        compact={props.settings}
        channelName={props.channelName}
        sharedWithTeam={call.isSharedWithTeam()}
        disabled={call.isConnecting() || sharing.isPending()}
        onToggle={() => fireAndForget(sharing.toggle(), 'call-quick-controls')}
        onOpenChange={() => {}}
      />
    </Show>
  );
  const ReactionControl = () => (
    <Show when={props.onReaction}>
      {(send) => (
        <CallReactionMenu compact onReaction={send()} onOpenChange={() => {}} />
      )}
    </Show>
  );
  return (
    <Show
      when={props.settings}
      fallback={
        <div class="flex items-center gap-1.5 p-2">
          <Button
            variant="secondary"
            size={props.size ?? 'icon-md'}
            aria-label={
              call.isAudioMuted()
                ? t('calls.microphoneOn')
                : t('calls.microphoneOff')
            }
            disabled={call.isConnecting()}
            onClick={() =>
              fireAndForget(call.toggleAudio(), 'call-quick-controls')
            }
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
              size={props.size ?? 'icon-md'}
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
              size={props.size ?? 'icon-md'}
              aria-label={t('calls.shareScreenTitle')}
              disabled={call.isConnecting() || screenUnavailable()}
              onClick={() =>
                fireAndForget(call.toggleScreenShare(), 'call-quick-controls')
              }
            >
              <Screencast class="size-4" />
            </Button>
          </Show>
          <SharingControl />
          <ReactionControl />
          <span class="flex-1" />
          <Show when={companion.canLeave()}>
            <Button
              variant="danger"
              size={props.size ?? 'icon-md'}
              class="min-w-11"
              aria-label={t('calls.leave')}
              onClick={() =>
                fireAndForget(companion.leave(), 'call-quick-controls')
              }
            >
              <PhoneDisconnect class="size-4" />
            </Button>
          </Show>
        </div>
      }
    >
      <CallMediaControls
        compact
        unframed
        media={call}
        screenUnavailable={screenUnavailable()}
        canLeave={companion.canLeave()}
        onLeave={() => companion.leave()}
      >
        <SharingControl />
        <ReactionControl />
      </CallMediaControls>
    </Show>
  );
}
