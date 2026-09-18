import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import { cn, InlineCheckbox, Tooltip } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import { For, type JSXElement, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import {
  CALL_PANEL_MEDIUM_NARROW_PX,
  CALL_PANEL_VERY_NARROW_PX,
} from './call-panel-breakpoints';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { TrackView } from './TrackView';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

function VideoTag(props: {
  children: JSXElement;
  class?: string;
  variant?: 'default' | 'truncated';
}) {
  return (
    <div
      class={cn(
        'absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink text-xs',
        props.variant === 'truncated' ? 'truncate max-w-[80%]' : '',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function ParticipantTileWrapper(props: {
  isSpeaking: boolean;
  children: JSXElement;
  isConnecting?: boolean;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'relative flex items-center justify-center rounded-lg overflow-hidden bg-panel min-h-30 border border-edge-muted',
        props.isSpeaking && 'ring-inset ring-2 ring-accent',
        props.isConnecting && 'animate-pulse',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

type ParticipantAvatarRenderer = (
  userId: string | undefined,
  name: string | undefined
) => JSXElement;

function ParticipantAvatar(props: {
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
  renderAvatar?: ParticipantAvatarRenderer;
}) {
  const avatarClass = () =>
    cn(
      'overflow-hidden rounded-full',
      props.avatarSize === 'sm' ? 'size-12' : 'size-20 sm:size-24'
    );

  const fallbackInitial = () => {
    const name = props.fallbackName?.trim();
    return (name ? name.charAt(0) : 'Y').toUpperCase();
  };

  return (
    <div class="flex items-center justify-center size-full p-4">
      <div class={avatarClass()}>
        <Show
          when={props.renderAvatar}
          fallback={
            <Show
              when={props.userId?.trim()}
              keyed
              fallback={
                <div
                  class={cn(
                    'flex size-full items-center justify-center rounded-full bg-ink-extra-muted text-surface font-semibold',
                    props.avatarSize === 'sm' ? 'text-xl' : 'text-4xl'
                  )}
                >
                  {fallbackInitial()}
                </div>
              }
            >
              {(userId) => (
                <UserIcon
                  id={userId}
                  size="fill"
                  suppressClick
                  showTooltip={false}
                />
              )}
            </Show>
          }
        >
          {(render) => render()(props.userId, props.fallbackName)}
        </Show>
      </div>
    </div>
  );
}

function LocalParticipantTile(props: {
  isSpeaking: boolean;
  isConnecting: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
  renderAvatar?: ParticipantAvatarRenderer;
  class?: string;
}) {
  return (
    <ParticipantTileWrapper
      isSpeaking={props.isSpeaking}
      isConnecting={props.isConnecting}
      class={props.class}
    >
      <Show
        when={!props.isConnecting && !props.isVideoMuted}
        fallback={
          <ParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
            renderAvatar={props.renderAvatar}
          />
        }
      >
        <TrackView track={props.track} mirror />
      </Show>

      <MutedMicrophoneBadge muted={props.isAudioMuted} label="You are muted" />

      <Show when={props.isConnecting} fallback={<VideoTag>You</VideoTag>}>
        <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink-muted text-xs">
          Connecting...
        </div>
      </Show>
    </ParticipantTileWrapper>
  );
}

function ParticipantTile(props: {
  participant: RemoteParticipant;
  renderAvatar?: ParticipantAvatarRenderer;
}) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const displayName = () =>
    props.participant.name?.trim() ||
    (macroId() ? getDisplayName(macroId()) : 'Guest');

  const cameraTrack = () => {
    callCtx.trackVersion();
    const pub = props.participant.getTrackPublication(LK_TRACK_SOURCE.Camera);
    return pub?.isSubscribed && !pub.isMuted ? pub.track : undefined;
  };

  const isAudioMuted = () => {
    callCtx.trackVersion();
    const publication = props.participant.getTrackPublication(
      LK_TRACK_SOURCE.Microphone
    );
    return publication?.isMuted ?? true;
  };

  const isSpeaking = () => callCtx.isParticipantSpeaking(props.participant);

  return (
    <ParticipantTileWrapper isSpeaking={isSpeaking()}>
      <Show
        when={cameraTrack()}
        fallback={
          <ParticipantAvatar
            userId={macroId()}
            fallbackName={displayName()}
            renderAvatar={props.renderAvatar}
          />
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>

      <MutedMicrophoneBadge
        muted={isAudioMuted()}
        label={`${displayName()} is muted`}
      />

      <VideoTag variant="truncated">{displayName()}</VideoTag>
    </ParticipantTileWrapper>
  );
}

function ScreenShareTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const displayName = () =>
    props.participant.name?.trim() ||
    (macroId() ? getDisplayName(macroId()) : 'Guest');
  const screenTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(LK_TRACK_SOURCE.ScreenShare)
      ?.track;
  };

  return (
    <div class="relative size-full flex items-center justify-center rounded-lg overflow-hidden bg-panel border border-edge-muted">
      <TrackView track={screenTrack()} fit="contain" />

      <VideoTag variant="truncated">{displayName()}'s screen</VideoTag>
    </div>
  );
}

export function CallOverlay(props: {
  onLeave: () => void;
  showTeamSharing?: boolean;
  sharedWithTeam?: boolean;
  localName?: string;
  renderAvatar?: ParticipantAvatarRenderer;
}) {
  const callCtx = useCallContext();
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const teamShare = useActiveCallTeamShare();
  const sharedWithTeam = () =>
    props.sharedWithTeam ?? callCtx.isSharedWithTeam();
  const teamShareLocked = () =>
    isConnecting() || !teamShare.canToggle() || teamShare.isPending();

  const splitPanel = useSplitPanel();
  const panelWidth = () => splitPanel?.panelSize.width ?? Infinity;
  const isMediumNarrow = () => panelWidth() < CALL_PANEL_MEDIUM_NARROW_PX;
  const isVeryNarrow = () => panelWidth() < CALL_PANEL_VERY_NARROW_PX;

  const participants = () =>
    Array.from(callCtx.remoteParticipants().values()).filter((p) => !p.isAgent);

  const isLocalSpeaking = () => callCtx.isLocalSpeaking();

  const localUserId = () => {
    callCtx.connectionState();
    callCtx.trackVersion();

    const identity = callCtx.room()?.localParticipant.identity?.trim();
    const macroIdentity = identity ? tryMacroId(identity) : undefined;
    const userId = currentUserId()?.trim();
    return macroIdentity ?? (userId ? tryMacroId(userId) : undefined);
  };

  const localVideoTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || callCtx.isVideoMuted()) return undefined;
    return r.localParticipant.getTrackPublication(LK_TRACK_SOURCE.Camera)
      ?.track;
  };

  const localScreenTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || !callCtx.isScreenSharing()) return undefined;
    return r.localParticipant.getTrackPublication(LK_TRACK_SOURCE.ScreenShare)
      ?.track;
  };

  const remoteScreenShares = () => {
    callCtx.trackVersion();
    return participants().filter((p) => {
      const pub = p.getTrackPublication(LK_TRACK_SOURCE.ScreenShare);
      return !!pub?.track && pub.isSubscribed && !pub.isMuted;
    });
  };

  const hasAnyScreenShare = () =>
    callCtx.isScreenSharing() || remoteScreenShares().length > 0;

  const gridCols = () => {
    const count = participants().length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div class="flex flex-col h-full touch:pb-(--mobile-content-inset-bottom)">
      {/* Screen share area */}
      <Show when={hasAnyScreenShare()}>
        <div class="flex-1 min-h-0 pt-2">
          <div class="h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
            <Show when={callCtx.isScreenSharing()}>
              <div class="relative size-full">
                <TrackView track={localScreenTrack()} fit="contain" />

                <VideoTag>Your screen</VideoTag>
              </div>
            </Show>
            <For each={remoteScreenShares()}>
              {(participant) => <ScreenShareTile participant={participant} />}
            </For>
          </div>
        </div>
      </Show>

      {/* Participants area */}
      <div
        class={`${hasAnyScreenShare() ? 'h-45 shrink-0' : 'flex-1 min-h-0'} relative pt-2`}
      >
        <Show
          when={participants().length > 0}
          fallback={
            <LocalParticipantTile
              class="size-full"
              isSpeaking={isLocalSpeaking()}
              isConnecting={isConnecting()}
              isAudioMuted={callCtx.isAudioMuted()}
              isVideoMuted={callCtx.isVideoMuted()}
              track={localVideoTrack()}
              userId={localUserId()}
              renderAvatar={props.renderAvatar}
              fallbackName={
                props.localName ||
                callCtx.room()?.localParticipant.name ||
                currentUserName()
              }
            />
          }
        >
          {/* Remote participants grid */}
          <div
            class={`size-full grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden`}
          >
            <For each={participants()}>
              {(participant) => (
                <ParticipantTile
                  participant={participant}
                  renderAvatar={props.renderAvatar}
                />
              )}
            </For>
          </div>

          {/* Local participant PIP (Google Meet style: small, bottom-right) */}
          <div class="absolute bottom-4 right-4 w-40 aspect-video shadow-lg z-10 sm:w-48">
            <LocalParticipantTile
              class="size-full min-h-0"
              isSpeaking={isLocalSpeaking()}
              isConnecting={isConnecting()}
              isAudioMuted={callCtx.isAudioMuted()}
              isVideoMuted={callCtx.isVideoMuted()}
              track={localVideoTrack()}
              userId={localUserId()}
              renderAvatar={props.renderAvatar}
              fallbackName={
                props.localName ||
                callCtx.room()?.localParticipant.name ||
                currentUserName()
              }
              avatarSize="sm"
            />
          </div>
        </Show>
      </div>

      {/* Controls bar — soup-notification vocabulary. Share toggle is an
          icon button (with optional inline label), active state = subtle
          accent tint. No chunky toggle switch. */}
      <div class="flex items-center py-2 relative justify-center">
        <Show
          when={
            callCtx.activeChannelId() !== null &&
            props.showTeamSharing !== false &&
            !isVeryNarrow()
          }
        >
          <Tooltip
            placement="top"
            label={
              sharedWithTeam()
                ? "The creator's team can view the transcript and AI summary once the call ends"
                : "Let the creator's team view the transcript and AI summary once the call ends"
            }
          >
            <button
              type="button"
              onClick={() => void teamShare.toggle()}
              disabled={teamShareLocked()}
              role="checkbox"
              aria-checked={sharedWithTeam()}
              class={cn(
                'absolute left-0 inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none',
                'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
                'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
                sharedWithTeam() && 'text-ink',
                teamShareLocked() && 'pointer-events-none opacity-50'
              )}
            >
              <InlineCheckbox checked={sharedWithTeam()} />
              <Show when={!isMediumNarrow()}>
                <span class="whitespace-nowrap">Share with team</span>
              </Show>
            </button>
          </Tooltip>
        </Show>
        <CallControls onLeave={props.onLeave} />
      </div>
    </div>
  );
}
