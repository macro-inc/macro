import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
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
import {
  BlockedMediaBadge,
  callMediaButtonVariant,
} from './CallControls/CallControlBar';
import { CallMediaControls } from './CallControls/CallMediaControls';
import { CallReactionMenu } from './CallControls/CallReactionMenu';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import {
  CallMediaPermissionHelp,
  createCallMediaPermissionHelp,
} from './CallMediaPermissionHelp';
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
  const permissionHelp = createCallMediaPermissionHelp(call);
  const sharing = useActiveCallTeamShare();
  const companion = useActiveCallCompanion();
  const audioBlocked = () => call.microphonePermission?.() === 'denied';
  const videoBlocked = () => call.cameraPermission?.() === 'denied';
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
        <CallReactionMenu
          compact
          smallIcon={!isMobile()}
          onReaction={send()}
          onOpenChange={() => {}}
        />
      )}
    </Show>
  );
  return (
    <Show
      when={props.settings}
      fallback={
        <div class="flex items-center gap-1.5 p-2">
          <div class="relative">
            <Button
              variant={callMediaButtonVariant(
                call.isAudioMuted(),
                call.isConnecting() || audioBlocked()
              )}
              size={props.size ?? 'icon-md'}
              aria-label={
                audioBlocked()
                  ? t('calls.microphoneBlocked')
                  : call.isAudioMuted()
                    ? t('calls.microphoneOn')
                    : t('calls.microphoneOff')
              }
              tooltip={
                audioBlocked() ? t('calls.microphoneBlockedTooltip') : undefined
              }
              disabled={call.isConnecting()}
              onClick={(event: MouseEvent) => {
                const trigger = event.currentTarget;
                fireAndForget(
                  permissionHelp.request(
                    'microphone',
                    false,
                    trigger instanceof HTMLElement ? trigger : undefined
                  ),
                  'call-quick-controls'
                );
              }}
            >
              <Show
                when={call.isAudioMuted() || audioBlocked()}
                fallback={<Microphone class="size-4" />}
              >
                <MicrophoneSlash
                  class={audioBlocked() ? 'size-4 text-ink-subtle' : 'size-4'}
                />
              </Show>
              <BlockedMediaBadge blocked={audioBlocked()} />
            </Button>
          </div>
          <Show when={props.controls.includes('camera')}>
            <div class="relative">
              <Button
                variant={callMediaButtonVariant(
                  call.isVideoMuted(),
                  call.isConnecting() || videoBlocked()
                )}
                size={props.size ?? 'icon-md'}
                aria-label={
                  videoBlocked()
                    ? t('calls.cameraBlocked')
                    : call.isVideoMuted()
                      ? t('calls.cameraOn')
                      : t('calls.cameraOff')
                }
                tooltip={
                  videoBlocked() ? t('calls.cameraBlockedTooltip') : undefined
                }
                disabled={call.isConnecting()}
                onClick={(event: MouseEvent) => {
                  const trigger = event.currentTarget;
                  fireAndForget(
                    permissionHelp.request(
                      'camera',
                      false,
                      trigger instanceof HTMLElement ? trigger : undefined
                    ),
                    'call-quick-controls'
                  );
                }}
              >
                <Show
                  when={call.isVideoMuted() || videoBlocked()}
                  fallback={<VideoCamera class="size-4" />}
                >
                  <VideoCameraSlash
                    class={videoBlocked() ? 'size-4 text-ink-subtle' : 'size-4'}
                  />
                </Show>
                <BlockedMediaBadge blocked={videoBlocked()} />
              </Button>
            </div>
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
          <CallMediaPermissionHelp controller={permissionHelp} />
        </div>
      }
    >
      <CallMediaControls
        compact
        unframed
        smallIcons={!isMobile()}
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
