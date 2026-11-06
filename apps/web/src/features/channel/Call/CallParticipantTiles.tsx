import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import Screencast from '@icon/system/regular/screencast.svg';
import { Badge, Button, cn } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import { type JSXElement, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { TrackView } from './TrackView';

function VideoTag(props: {
  children: JSXElement;
  class?: string;
  variant?: 'default' | 'truncated';
  isProgram?: boolean;
  muted?: boolean;
  mutedLabel?: string;
  sharing?: boolean;
}) {
  return (
    <div
      class={cn(
        'absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-surface/70 px-1.5 py-0.5 text-ink text-xs',
        props.variant === 'truncated' && 'max-w-[80%]',
        props.class
      )}
    >
      <Show when={props.sharing}>
        <Screencast class="size-3 shrink-0" />
      </Show>
      <MutedMicrophoneBadge
        muted={props.muted ?? false}
        label={props.mutedLabel ?? ''}
        inline
      />
      <span class="min-w-0 truncate">{props.children}</span>
      <Show when={props.isProgram}>
        <Badge variant="secondary" size="xs">
          {t('calls.agent')}
        </Badge>
      </Show>
    </div>
  );
}

function ParticipantTileWrapper(props: {
  isSpeaking: boolean;
  children: JSXElement;
  isConnecting?: boolean;
  isFocused?: boolean;
  onToggleFocus?: () => void;
  focusLabel?: string;
  hidden?: boolean;
  class?: string;
}) {
  // Fills its cell, but never wider than 16:9: on a wide panel a full-width
  // tile crops a 16:9 camera to a zoomed-in strip. Taller cells (phones,
  // grids) still fill, so portrait video keeps the space.
  // Cells can shrink to fit the screen-share strip and picture-in-picture grid.
  return (
    <div
      hidden={props.hidden}
      class={cn(
        'flex size-full min-h-0 items-center justify-center [container-type:size]',
        props.class
      )}
    >
      <div
        data-call-tile=""
        class={cn(
          'relative isolate flex h-full w-[min(100cqw,calc(100cqh*16/9))] items-center justify-center rounded-lg overflow-hidden bg-panel border border-edge-muted',
          props.isConnecting && 'animate-pulse'
        )}
      >
        {props.children}
        <Show when={props.isSpeaking}>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 z-20 rounded-[inherit] border-2 border-success"
          />
        </Show>
        <Show when={props.onToggleFocus}>
          <button
            type="button"
            class="absolute inset-0 z-30 rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
            aria-label={props.focusLabel}
            aria-pressed={props.isFocused ?? false}
            onClick={props.onToggleFocus}
          />
        </Show>
        <Show when={props.isFocused && props.onToggleFocus}>
          <Button
            variant="primary"
            size="sm"
            class="absolute right-2 top-2 z-40"
            onClick={props.onToggleFocus}
          >
            Back to grid
          </Button>
        </Show>
      </div>
    </div>
  );
}

function ParticipantAvatar(props: {
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
    <div class="relative flex items-center justify-center size-full p-4">
      <div class={cn('relative', avatarClass())}>
        <div
          class={cn(
            'flex size-full items-center justify-center rounded-full bg-ink-extra-muted text-surface font-semibold',
            props.avatarSize === 'sm' ? 'text-xl' : 'text-4xl'
          )}
        >
          {fallbackInitial()}
        </div>
      </div>
    </div>
  );
}

export function LocalParticipantTile(props: {
  isSpeaking: boolean;
  isConnecting: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
  userId: string | undefined;
  fallbackName: string | undefined;
  isProgram: boolean;
  avatarSize?: 'sm' | 'md';
  class?: string;
  isFocused?: boolean;
  onToggleFocus?: () => void;
}) {
  return (
    <ParticipantTileWrapper
      isSpeaking={props.isSpeaking}
      isConnecting={props.isConnecting}
      class={props.class}
      isFocused={props.isFocused}
      onToggleFocus={props.onToggleFocus}
      focusLabel={props.isFocused ? 'Unfocus yourself' : 'Focus yourself'}
    >
      <Show
        when={!props.isConnecting && !props.isVideoMuted}
        fallback={
          <ParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
          />
        }
      >
        <TrackView track={props.track} mirror />
      </Show>

      <Show
        when={props.isConnecting}
        fallback={
          <VideoTag
            isProgram={props.isProgram}
            muted={props.isAudioMuted}
            mutedLabel="You are muted"
          >
            You
          </VideoTag>
        }
      >
        <div class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-surface/70 text-ink-muted text-xs">
          Connecting...
        </div>
      </Show>
    </ParticipantTileWrapper>
  );
}

export function ParticipantTile(props: {
  participant: RemoteParticipant;
  avatarSize?: 'sm' | 'md';
  filmstrip?: boolean;
  sidebar?: boolean;
  isFocused: boolean;
  hidden: boolean;
  onToggleFocus: () => void;
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
    <ParticipantTileWrapper
      isSpeaking={isSpeaking()}
      isFocused={props.isFocused}
      onToggleFocus={props.onToggleFocus}
      focusLabel={`${props.isFocused ? 'Unfocus' : 'Focus'} ${displayName()}`}
      hidden={props.hidden}
      class={cn(
        'min-w-0',
        props.filmstrip && 'max-w-36',
        props.sidebar && 'h-auto aspect-video shrink-0',
        props.hidden && 'hidden'
      )}
    >
      <Show
        when={cameraTrack()}
        fallback={
          <ParticipantAvatar
            userId={macroId()}
            fallbackName={displayName()}
            avatarSize={props.avatarSize}
          />
        }
      >
        <TrackView track={cameraTrack()} />
      </Show>

      <VideoTag
        variant="truncated"
        isProgram={isProgramParticipant(props.participant.attributes)}
        muted={isAudioMuted()}
        mutedLabel={`${displayName()} is muted`}
        sharing={(() => {
          callCtx.trackVersion();
          const publication = props.participant.getTrackPublication(
            LK_TRACK_SOURCE.ScreenShare
          );
          return publication?.isMuted === false;
        })()}
      >
        {displayName()}
      </VideoTag>
    </ParticipantTileWrapper>
  );
}

export function ScreenShareTile(props: { participant: RemoteParticipant }) {
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

      <VideoTag
        variant="truncated"
        isProgram={isProgramParticipant(props.participant.attributes)}
      >
        <span class="flex items-center gap-1.5">
          <Show when={macroId()}>
            {(id) => (
              <span
                class={cn(
                  'size-5 shrink-0 rounded-full',
                  callCtx.isParticipantSpeaking(props.participant) &&
                    'outline-2 -outline-offset-2 outline-success'
                )}
              >
                <UserIcon id={id()} size="fill" suppressClick />
              </span>
            )}
          </Show>
          <Screencast class="size-3.5" />
          {t('calls.presenterSharing', { name: displayName() })}
        </span>
      </VideoTag>
    </div>
  );
}
