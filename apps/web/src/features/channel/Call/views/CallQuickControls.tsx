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
import { createContext, type ParentProps, Show, useContext } from 'solid-js';
import { useCallContext } from '../CallContext';
import {
  BlockedMediaBadge,
  callMediaButtonVariant,
} from '../CallControls/CallControlBar';
import { CallMediaControls } from '../CallControls/CallMediaControls';
import { CallSharingMenu } from '../CallControls/CallSharingMenu';
import { CallReactionMenu } from '../components/CallReactionMenu';
import type { CallReactionEmoji } from '../core/call-reactions';
import { LK_TRACK_SOURCE } from '../livekit-loader';
import { createCallMediaPermissionHelp } from '../primitives/create-call-media-permission-help';
import { useActiveCallCompanion } from '../primitives/use-active-call-companion';
import { useActiveCallTeamShare } from '../use-toggle-share-with-team';
import { CallMediaPermissionHelp } from './CallMediaPermissionHelp';

function createQuickControls(size: () => 'icon-md' | 'icon-lg') {
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
  return {
    call,
    permissionHelp,
    sharing,
    companion,
    audioBlocked,
    videoBlocked,
    screenUnavailable,
    size,
  };
}
const QuickContext = createContext<ReturnType<typeof createQuickControls>>();
function useQuickControls() {
  const context = useContext(QuickContext);
  if (!context)
    throw new Error('Quick controls require CallQuickControls.Root');
  return context;
}
function Root(props: ParentProps<{ size?: 'icon-md' | 'icon-lg' }>) {
  const value = createQuickControls(() => props.size ?? 'icon-md');
  return (
    <QuickContext.Provider value={value}>
      {props.children}
    </QuickContext.Provider>
  );
}
function Frame(props: ParentProps) {
  const { permissionHelp } = useQuickControls();
  return (
    <div class="flex items-center gap-1.5 p-2">
      {props.children}
      <CallMediaPermissionHelp controller={permissionHelp} />
    </div>
  );
}
function Settings(props: ParentProps) {
  const { call } = useQuickControls();
  return (
    <CallMediaControls.Root
      compact
      unframed
      smallIcons={!isMobile()}
      media={call}
    >
      {props.children}
    </CallMediaControls.Root>
  );
}
function MicrophoneControl() {
  const { call, permissionHelp, audioBlocked, size } = useQuickControls();
  const microphoneLabel = () => {
    if (audioBlocked()) return t('calls.microphoneBlocked');
    return call.isAudioMuted()
      ? t('calls.unmuteMicrophone')
      : t('calls.muteMicrophone');
  };
  return (
    <div class="relative">
      <Button
        variant={callMediaButtonVariant(
          call.isAudioMuted(),
          call.isConnecting() || audioBlocked()
        )}
        size={size()}
        aria-label={microphoneLabel()}
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
  );
}
function CameraControl() {
  const { call, permissionHelp, videoBlocked, size } = useQuickControls();
  const cameraLabel = () => {
    if (videoBlocked()) return t('calls.cameraBlocked');
    return call.isVideoMuted()
      ? t('calls.turnOnCamera')
      : t('calls.turnOffCamera');
  };
  return (
    <div class="relative">
      <Button
        variant={callMediaButtonVariant(
          call.isVideoMuted(),
          call.isConnecting() || videoBlocked()
        )}
        size={size()}
        aria-label={cameraLabel()}
        tooltip={videoBlocked() ? t('calls.cameraBlockedTooltip') : undefined}
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
  );
}
function ScreenControl() {
  const { call, screenUnavailable, size } = useQuickControls();
  return (
    <Button
      variant={call.isScreenSharing() ? 'accent' : 'secondary'}
      size={size()}
      aria-label={t('calls.shareScreenTitle')}
      disabled={call.isConnecting() || screenUnavailable()}
      onClick={() =>
        fireAndForget(call.toggleScreenShare(), 'call-quick-controls')
      }
    >
      <Screencast class="size-4" />
    </Button>
  );
}
function LeaveControl() {
  const { companion, size } = useQuickControls();
  return (
    <Show when={companion.canLeave()}>
      <Button
        variant="danger"
        size={size()}
        class="min-w-11"
        aria-label={t('calls.leave')}
        onClick={() => fireAndForget(companion.leave(), 'call-quick-controls')}
      >
        <PhoneDisconnect class="size-4" />
      </Button>
    </Show>
  );
}
function SharingControl(props: { channelName?: string }) {
  const { call, sharing } = useQuickControls();
  return (
    <Show when={sharing.canToggle()}>
      <CallSharingMenu
        size="md"
        compact
        channelName={props.channelName}
        sharedWithTeam={call.isSharedWithTeam()}
        disabled={call.isConnecting() || sharing.isPending()}
        onToggle={() => fireAndForget(sharing.toggle(), 'call-quick-controls')}
        onOpenChange={() => {}}
      />
    </Show>
  );
}
function Reactions(props: { onReaction: (emoji: CallReactionEmoji) => void }) {
  return (
    <CallReactionMenu
      compact
      smallIcon={!isMobile()}
      onReaction={props.onReaction}
      onOpenChange={() => {}}
    />
  );
}
function MediaScreen() {
  const { screenUnavailable } = useQuickControls();
  return <CallMediaControls.Screen unavailable={screenUnavailable()} />;
}
function MediaLeave() {
  const { companion } = useQuickControls();
  return (
    <Show when={companion.canLeave()}>
      <CallMediaControls.Leave onLeave={companion.leave} />
    </Show>
  );
}
export const CallQuickControls = {
  Root,
  Frame,
  Settings,
  Microphone: MicrophoneControl,
  Camera: CameraControl,
  Screen: ScreenControl,
  Leave: LeaveControl,
  Sharing: SharingControl,
  Reactions,
  MediaMicrophone: CallMediaControls.Microphone,
  MediaCamera: CallMediaControls.Camera,
  MediaScreen,
  MediaLeave,
};
