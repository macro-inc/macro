import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { cn, InlineCheckbox, Tooltip } from '@ui';
import { type RemoteParticipant, Track } from 'livekit-client';
import { For, type JSXElement, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import {
  CALL_PANEL_MEDIUM_NARROW_PX,
  CALL_PANEL_VERY_NARROW_PX,
} from './call-panel-breakpoints';
import { TrackView } from './TrackView';
import { useToggleShareWithTeam } from './use-toggle-share-with-team';

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
        'relative flex items-center justify-center rounded-lg overflow-hidden bg-message min-h-30 border border-edge-muted',
        props.isSpeaking && 'ring-inset ring-2 ring-accent-2',
        props.isConnecting && 'animate-pulse',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function LocalParticipantAvatar(props: {
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
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
      </div>
    </div>
  );
}

function LocalParticipantTile(props: {
  isSpeaking: boolean;
  isConnecting: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
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
          <LocalParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
          />
        }
      >
        <TrackView track={props.track} mirror />
      </Show>

      <Show when={props.isConnecting} fallback={<VideoTag>You</VideoTag>}>
        <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink-muted text-xs">
          Connecting...
        </div>
      </Show>
    </ParticipantTileWrapper>
  );
}

function ParticipantTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const [displayName] = useDisplayName(macroId());

  const cameraTrack = () => {
    callCtx.trackVersion();
    const pub = props.participant.getTrackPublication(Track.Source.Camera);
    return pub?.isSubscribed && !pub.isMuted ? pub.track : undefined;
  };

  const isSpeaking = () => callCtx.isParticipantSpeaking(props.participant);

  return (
    <ParticipantTileWrapper isSpeaking={isSpeaking()}>
      <Show
        when={cameraTrack()}
        fallback={
          <div class="flex items-center justify-center size-full p-4">
            <div class="size-12 rounded-full bg-hover flex items-center justify-center text-ink-muted text-lg font-medium">
              {displayName().charAt(0).toUpperCase()}
            </div>
          </div>
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>

      <VideoTag variant="truncated">{displayName()}</VideoTag>
    </ParticipantTileWrapper>
  );
}

function ScreenShareTile(props: { participant: RemoteParticipant }) {
  const callCtx = useCallContext();
  const macroId = () => tryMacroId(props.participant.identity);
  const [displayName] = useDisplayName(macroId());
  const screenTrack = () => {
    callCtx.trackVersion();
    return props.participant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
  };

  return (
    <div class="relative size-full flex items-center justify-center rounded-lg overflow-hidden bg-message border border-edge-muted">
      <TrackView track={screenTrack()} fit="contain" />

      <VideoTag variant="truncated">{displayName()}'s screen</VideoTag>
    </div>
  );
}

export function CallOverlay(props: { onLeave: () => void }) {
  const callCtx = useCallContext();
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const handleToggleShareWithTeam = useToggleShareWithTeam();

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
    return macroIdentity ?? userId ?? identity;
  };

  const localVideoTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || callCtx.isVideoMuted()) return undefined;
    return r.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  };

  const localScreenTrack = () => {
    callCtx.trackVersion();
    const r = callCtx.room();
    if (!r || !callCtx.isScreenSharing()) return undefined;
    return r.localParticipant.getTrackPublication(Track.Source.ScreenShare)
      ?.track;
  };

  const remoteScreenShares = () => {
    callCtx.trackVersion();
    return participants().filter((p) => {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
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
    <div class="flex flex-col h-full">
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
              isVideoMuted={callCtx.isVideoMuted()}
              track={localVideoTrack()}
              userId={localUserId()}
              fallbackName={currentUserName()}
            />
          }
        >
          {/* Remote participants grid */}
          <div
            class={`size-full grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden`}
          >
            <For each={participants()}>
              {(participant) => <ParticipantTile participant={participant} />}
            </For>
          </div>

          {/* Local participant PIP (Google Meet style: small, bottom-right) */}
          <div class="absolute bottom-4 right-4 w-40 aspect-video shadow-lg z-10 sm:w-48">
            <LocalParticipantTile
              class="size-full min-h-0"
              isSpeaking={isLocalSpeaking()}
              isConnecting={isConnecting()}
              isVideoMuted={callCtx.isVideoMuted()}
              track={localVideoTrack()}
              userId={localUserId()}
              fallbackName={currentUserName()}
              avatarSize="sm"
            />
          </div>
        </Show>
      </div>

      {/* Controls bar — soup-notification vocabulary. Share toggle is an
          icon button (with optional inline label), active state = subtle
          accent tint. No chunky toggle switch. */}
      <div class="flex items-center py-2 relative justify-center">
        <Show when={!isVeryNarrow()}>
          <Tooltip
            placement="top"
            label={
              callCtx.isSharedWithTeam()
                ? 'Everyone can view the transcript and AI summary'
                : 'Let everyone view the transcript and AI summary'
            }
          >
            <button
              type="button"
              onClick={() => void handleToggleShareWithTeam()}
              disabled={isConnecting()}
              role="checkbox"
              aria-checked={callCtx.isSharedWithTeam()}
              class={cn(
                'absolute left-0 inline-flex items-center gap-2 rounded-md h-7 px-2.5 text-xs select-none',
                'border border-ink-muted/[0.08] bg-ink-muted/[0.025]',
                'text-ink-muted/70 hover:text-ink hover:bg-ink-muted/[0.06]',
                callCtx.isSharedWithTeam() && 'text-ink',
                isConnecting() && 'pointer-events-none opacity-50'
              )}
            >
              <InlineCheckbox checked={callCtx.isSharedWithTeam()} />
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
