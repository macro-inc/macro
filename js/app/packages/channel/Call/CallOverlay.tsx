import { tryMacroId, useDisplayName } from '@core/user';
import { cn } from '@ui';
import { type RemoteParticipant, Track } from 'livekit-client';
import { For, type JSXElement, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import { TrackView } from './TrackView';

function VideoTag(props: {
  children: JSXElement;
  class?: string;
  variant?: 'default' | 'truncated';
}) {
  return (
    <div
      class={cn(
        'absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-panel/70 text-ink text-xs',
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
        'relative flex items-center justify-center rounded-lg overflow-hidden bg-surface-2 min-h-30',
        props.class
      )}
      classList={{
        'ring-inset ring-2 ring-accent-2': props.isSpeaking,
        'animate-pulse': props.isConnecting,
      }}
    >
      {props.children}
    </div>
  );
}

function LocalParticipantTile(props: {
  isSpeaking: boolean;
  isConnecting: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
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
          <div class="flex items-center justify-center size-full p-4">
            <div
              class={cn(
                'rounded-full bg-surface-3 flex items-center justify-center text-ink-muted font-medium',
                props.avatarSize === 'sm' ? 'size-8 text-sm' : 'size-12 text-lg'
              )}
            >
              You
            </div>
          </div>
        }
      >
        <TrackView track={props.track} mirror />
      </Show>

      <Show when={props.isConnecting} fallback={<VideoTag>You</VideoTag>}>
        <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-panel/70 text-ink-muted text-xs">
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
          <div class="flex items-center justify-center size-full p-4 ring-2 ring-accent-2">
            <div class="size-12 rounded-full bg-surface-3 flex items-center justify-center text-ink-muted text-lg font-medium">
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
    <div class="relative size-full flex items-center justify-center rounded-lg overflow-hidden bg-surface-2">
      <TrackView track={screenTrack()} fit="contain" />

      <VideoTag variant="truncated">{displayName()}'s screen</VideoTag>
    </div>
  );
}

export function CallOverlay(props: { onLeave: () => void }) {
  const callCtx = useCallContext();
  const isConnecting = () => callCtx.isConnecting();

  const participants = () =>
    Array.from(callCtx.remoteParticipants().values()).filter((p) => !p.isAgent);

  const isLocalSpeaking = () => callCtx.isLocalSpeaking();

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
        class={`${hasAnyScreenShare() ? 'h-45 shrink-0' : 'flex-1 min-h-0'} relative py-2`}
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
              avatarSize="sm"
            />
          </div>
        </Show>
      </div>

      {/* Controls bar */}
      <div class="flex items-center justify-center p-3 pt-1 bg-surface-1">
        <CallControls onLeave={props.onLeave} />
      </div>
    </div>
  );
}
