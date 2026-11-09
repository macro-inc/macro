import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import PinIcon from '@icon/system/regular/push-pin.svg';
import UnpinIcon from '@icon/system/regular/push-pin-slash.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import { Popover } from '@kobalte/core/popover';
import { Badge, Button, cn } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import { createSignal, type JSXElement, Show } from 'solid-js';
import { useCallContext } from './CallContext';
import { CallParticipantVolume } from './CallParticipantVolume';
import { useCallVolumeOptional } from './call-volume';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedForYouBadge } from './MutedForYouBadge';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { TrackView } from './TrackView';

function VideoTag(props: {
  children: JSXElement;
  class?: string;
  variant?: 'default' | 'truncated';
  isProgram?: boolean;
  muted?: boolean;
  mutedForYou?: boolean;
  mutedLabel?: string;
  sharing?: boolean;
  pinned?: boolean;
}) {
  return (
    <div
      class={cn(
        'absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-surface/70 px-1.5 py-0.5 text-ink text-xs',
        props.variant === 'truncated' && 'max-w-[80%]',
        props.class
      )}
    >
      <Show when={props.pinned}>
        <PinIcon class="size-3 shrink-0" />
      </Show>
      <Show when={props.sharing}>
        <Screencast class="size-3 shrink-0" />
      </Show>
      <MutedMicrophoneBadge
        muted={props.muted ?? false}
        label={props.mutedLabel ?? ''}
        inline
      />
      <MutedForYouBadge muted={!!props.mutedForYou} inline />
      <span class="min-w-0 truncate">{props.children}</span>
      <Show when={props.isProgram}>
        <Badge variant="secondary" size="xs">
          {t('calls.agent')}
        </Badge>
      </Show>
    </div>
  );
}

function trackAspectRatio(track: Track | undefined) {
  const settings = track?.mediaStreamTrack?.getSettings?.();
  return settings?.width && settings.height
    ? settings.width / settings.height
    : 16 / 9;
}

function ParticipantTileWrapper(props: {
  isSpeaking: boolean;
  stage?: boolean;
  aspectRatio?: number;
  participantId?: string;
  children: JSXElement;
  isConnecting?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  pinName?: string;
  pinEnabled?: boolean;
  hidden?: boolean;
  actions?: JSXElement;
  class?: string;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let tile: HTMLDivElement | undefined;
  const openMenu = () => {
    if (isMobile() && props.pinEnabled) setMenuOpen(true);
  };
  // Fills its cell, but never wider than 16:9: on a wide panel a full-width
  // tile crops a 16:9 camera to a zoomed-in strip. Taller cells (phones,
  // grids) still fill, so portrait video keeps the space.
  // Cells can shrink to fit the screen-share strip and picture-in-picture grid.
  return (
    <Popover
      open={menuOpen()}
      onOpenChange={setMenuOpen}
      placement="bottom-end"
      gutter={8}
      getAnchorRect={() => tile?.getBoundingClientRect()}
    >
      <div
        hidden={props.hidden}
        class={cn(
          'flex size-full min-h-0 items-center justify-center [container-type:size]',
          menuOpen() && 'relative z-40 scale-[1.02] motion-reduce:scale-100',
          props.class
        )}
      >
        <div
          ref={(element) => {
            tile = element;
            touchHandler(element, () => ({
              onLongPress: (event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest('button, input, [role="slider"]')
                )
                  return;
                openMenu();
              },
            }));
          }}
          onContextMenu={(event) => {
            if (!isMobile()) return;
            event.preventDefault();
            openMenu();
          }}
          data-call-tile=""
          data-call-stage={props.stage ? '' : undefined}
          style={
            props.stage
              ? {
                  width: `min(100cqw,calc(100cqh * ${props.aspectRatio ?? 16 / 9}))`,
                  height: `min(100cqh,calc(100cqw / ${props.aspectRatio ?? 16 / 9}))`,
                }
              : undefined
          }
          data-call-participant={props.participantId}
          class={cn(
            'group/tile relative isolate flex h-full w-[min(100cqw,calc(100cqh*16/9))] items-center justify-center rounded-lg overflow-hidden bg-panel border border-edge-muted',
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
          <Show when={props.pinEnabled && props.onTogglePin && !isMobile()}>
            <button
              type="button"
              class="absolute inset-0 z-30 rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
              aria-label={t(
                props.isPinned ? 'calls.unpinNamed' : 'calls.pinNamed',
                { name: props.pinName ?? '' }
              )}
              aria-pressed={props.isPinned ?? false}
              onClick={props.onTogglePin}
            />
          </Show>
          <div
            class={cn(
              'absolute top-2 right-2 z-40 flex items-center gap-1 opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto group-focus-within/tile:opacity-100 group-focus-within/tile:pointer-events-auto [&:has([data-expanded])]:opacity-100 [&:has([data-expanded])]:pointer-events-auto',
              isMobile() && props.isPinned && 'opacity-100 pointer-events-auto'
            )}
          >
            {props.actions}
            <Show
              when={
                props.pinEnabled &&
                props.onTogglePin &&
                (!isMobile() || props.isPinned)
              }
            >
              <Button
                appearance="bare"
                variant="ghost"
                size={props.isPinned ? 'sm' : 'icon-sm'}
                class="rounded-full bg-surface/70 text-ink gap-1"
                aria-label={t(
                  props.isPinned ? 'calls.unpinNamed' : 'calls.pinNamed',
                  { name: props.pinName ?? '' }
                )}
                tooltip={{
                  content: t(props.isPinned ? 'calls.unpin' : 'calls.pin'),
                  placement: 'top',
                }}
                onClick={props.onTogglePin}
              >
                <Show
                  when={props.isPinned}
                  fallback={<PinIcon class="size-4" />}
                >
                  <UnpinIcon class="size-4" />
                  {t('calls.unpin')}
                </Show>
              </Button>
            </Show>
          </div>
        </div>
      </div>
      <Show when={menuOpen()}>
        <Popover.Portal
          mount={
            tile?.closest<HTMLElement>('[data-call-participant-stage]') ??
            undefined
          }
        >
          <div
            class="absolute inset-0 z-30 bg-overlay"
            aria-hidden="true"
            onPointerDown={() => setMenuOpen(false)}
          />
          <Popover.Content
            class="menu-surface z-action-menu min-w-48 max-w-[calc(100vw-2rem)] rounded-xl p-2 outline-none"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <Popover.Title class="px-2 py-1 text-sm text-ink-muted">
              {props.pinName}
            </Popover.Title>
            <Button
              variant="ghost"
              class="w-full justify-start gap-2"
              onClick={() => {
                setMenuOpen(false);
                props.onTogglePin?.();
              }}
            >
              <Show when={props.isPinned} fallback={<PinIcon class="size-4" />}>
                <UnpinIcon class="size-4" />
              </Show>
              {t(props.isPinned ? 'calls.unpin' : 'calls.pin')}
            </Button>
          </Popover.Content>
        </Popover.Portal>
      </Show>
    </Popover>
  );
}

function ParticipantAvatar(props: {
  userId: string | undefined;
  fallbackName: string | undefined;
  avatarSize?: 'sm' | 'md';
  mutedForYou?: boolean;
  muted?: boolean;
}) {
  const avatarClass = () =>
    cn(
      'rounded-full',
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
        <MutedForYouBadge muted={!!props.mutedForYou} />
        <MutedMicrophoneBadge muted={!!props.muted} avatar />
      </div>
    </div>
  );
}

export function LocalParticipantTile(props: {
  identity?: string;
  isSpeaking: boolean;
  isConnecting: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  track: Track | undefined;
  userId: string | undefined;
  fallbackName: string | undefined;
  isProgram: boolean;
  stage?: boolean;
  avatarSize?: 'sm' | 'md';
  class?: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  pinEnabled?: boolean;
}) {
  return (
    <ParticipantTileWrapper
      isSpeaking={props.isSpeaking}
      stage={props.stage}
      aspectRatio={trackAspectRatio(props.track)}
      participantId={props.identity ?? props.userId}
      isConnecting={props.isConnecting}
      class={props.class}
      isPinned={props.isPinned}
      onTogglePin={props.onTogglePin}
      pinEnabled={props.pinEnabled}
      pinName={t('calls.you')}
    >
      <Show
        when={!props.isConnecting && !props.isVideoMuted}
        fallback={
          <ParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
            muted={props.isAudioMuted}
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
            pinned={props.isPinned}
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
  stage?: boolean;
  avatarSize?: 'sm' | 'md';
  filmstrip?: boolean;
  sidebar?: boolean;
  isPinned: boolean;
  hidden: boolean;
  onTogglePin: () => void;
  pinEnabled: boolean;
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
  const volumes = useCallVolumeOptional();
  const mutedForYou = () => volumes?.level(props.participant) === 0;

  return (
    <ParticipantTileWrapper
      isSpeaking={isSpeaking()}
      stage={props.stage}
      aspectRatio={trackAspectRatio(cameraTrack())}
      participantId={props.participant.identity}
      isPinned={props.isPinned}
      onTogglePin={props.onTogglePin}
      pinEnabled={props.pinEnabled}
      pinName={displayName()}
      actions={
        <CallParticipantVolume
          participant={props.participant}
          name={displayName()}
        />
      }
      hidden={props.hidden}
      class={cn(
        'min-w-0',
        props.filmstrip &&
          'max-w-36 h-auto max-h-full aspect-video self-center',
        props.sidebar && 'h-auto max-h-full aspect-video shrink-0',
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
            mutedForYou={mutedForYou()}
            muted={isAudioMuted()}
          />
        }
      >
        <TrackView
          track={cameraTrack()}
          fit={props.stage ? 'contain' : 'cover'}
        />
      </Show>

      <VideoTag
        variant="truncated"
        pinned={props.isPinned}
        isProgram={isProgramParticipant(props.participant.attributes)}
        muted={isAudioMuted()}
        mutedForYou={mutedForYou()}
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

export function ScreenShareTile(props: {
  participant: RemoteParticipant;
  isPinned: boolean;
  inStrip: boolean;
  onTogglePin: () => void;
  pinEnabled: boolean;
}) {
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
    <ParticipantTileWrapper
      isSpeaking={false}
      stage={!props.inStrip}
      class={
        props.inStrip ? 'h-auto max-h-full aspect-video self-center' : undefined
      }
      aspectRatio={trackAspectRatio(screenTrack())}
      participantId={props.participant.identity}
      isPinned={props.isPinned}
      onTogglePin={props.onTogglePin}
      pinEnabled={props.pinEnabled}
      pinName={t('calls.participantScreen', { name: displayName() })}
    >
      <TrackView track={screenTrack()} fit="contain" />

      <VideoTag
        variant="truncated"
        pinned={props.isPinned}
        isProgram={isProgramParticipant(props.participant.attributes)}
      >
        <span data-call-stage-chip="share" class="flex items-center gap-1.5">
          <Screencast class="size-3.5 shrink-0" />
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
          {props.inStrip
            ? t('calls.participantScreen', { name: displayName() })
            : t('calls.presenterSharing', { name: displayName() })}
        </span>
      </VideoTag>
    </ParticipantTileWrapper>
  );
}

export function LocalScreenShareTile(props: {
  isPinned: boolean;
  inStrip: boolean;
  pinEnabled: boolean;
  onTogglePin: () => void;
}) {
  const call = useCallContext();
  return (
    <ParticipantTileWrapper
      isSpeaking={false}
      stage={!props.inStrip}
      class={
        props.inStrip ? 'h-auto max-h-full aspect-video self-center' : undefined
      }
      isPinned={props.isPinned}
      pinName={t('calls.yourScreen')}
      pinEnabled={props.pinEnabled}
      onTogglePin={props.onTogglePin}
    >
      <div class="flex size-full flex-col items-center justify-center gap-3 p-4">
        <Show
          when={!props.inStrip}
          fallback={<VideoTag sharing>{t('calls.yourScreen')}</VideoTag>}
        >
          <Screencast class="size-10 text-accent" />
          <p class="font-semibold">{t('calls.youAreSharing')}</p>
          <p class="text-sm text-ink-muted">{t('calls.everyoneCanSee')}</p>
          <Button
            variant="danger"
            size="sm"
            class="relative z-40"
            onClick={() =>
              fireAndForget(call.toggleScreenShare(), 'channel-call')
            }
          >
            <Screencast class="size-4" />
            {t('calls.stopSharing')}
          </Button>
        </Show>
      </div>
    </ParticipantTileWrapper>
  );
}
