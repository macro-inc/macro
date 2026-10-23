import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import SidePanelIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button, cn } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  type JSXElement,
  lazy,
  Show,
  Suspense,
} from 'solid-js';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import { CallDetailsPanel, CallDetailsSections } from './CallDetails';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { ParticipantAvatarBackground } from './ParticipantAvatarBackground';
import { TrackView } from './TrackView';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

const CallChat = lazy(() => import('./chat/CallChat'));
const GuestCallChat = lazy(() => import('./chat/GuestCallChat'));

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
  // Fills its cell, but never wider than 16:9: on a wide panel a full-width
  // tile crops a 16:9 camera to a zoomed-in strip. Taller cells (phones,
  // grids) still fill, so portrait video keeps the space.
  // The minimum height sits on the cell: size containment ignores content.
  return (
    <div
      class={cn(
        'flex size-full min-h-30 items-center justify-center [container-type:size]',
        props.class
      )}
    >
      <div
        class={cn(
          'relative flex h-full w-[min(100cqw,calc(100cqh*16/9))] items-center justify-center rounded-lg overflow-hidden bg-panel border border-edge-muted',
          props.isSpeaking && 'ring-inset ring-2 ring-accent',
          props.isConnecting && 'animate-pulse'
        )}
      >
        {props.children}
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
      <Show when={props.userId?.trim()} keyed>
        {(userId) => <ParticipantAvatarBackground userId={userId} />}
      </Show>
      <div class={cn('relative', avatarClass())}>
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
  isAudioMuted: boolean;
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
          <ParticipantAvatar
            userId={props.userId}
            fallbackName={props.fallbackName}
            avatarSize={props.avatarSize}
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

function ParticipantTile(props: { participant: RemoteParticipant }) {
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
          <ParticipantAvatar userId={macroId()} fallbackName={displayName()} />
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

type CallOverlayProps = {
  onLeave: () => void;
  showTeamSharing?: boolean;
  sharedWithTeam?: boolean;
  localName?: string;
  /** The host may hide chat until account or guest session credentials are ready. */
  showChat?: boolean;
  /** Narrow RTC credential for a guest; never an account bearer. */
  guestChatSession?: { token: string; participantId: string };
  /** The host's share-link control, shown in the Details panel's Invite section. */
  inviteLink?: JSX.Element;
};

/**
 * The call view. Its right-hand panel shows either the call's Details
 * sections or its chat: opening chat swaps it in for Details, and closing it
 * brings Details back.
 */
export function CallOverlay(props: CallOverlayProps) {
  return (
    <SidePanel.Root defaultOpen={false} persistKey="call-details">
      <CallOverlayContent {...props} />
    </SidePanel.Root>
  );
}

function CallOverlayContent(props: CallOverlayProps) {
  const callCtx = useCallContext();
  const sidePanel = useSidePanel()!;
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const teamShare = useActiveCallTeamShare();
  const sharedWithTeam = () =>
    props.sharedWithTeam ?? callCtx.isSharedWithTeam();
  const [chatOpen, setChatOpen] = createSignal(false);
  const [chatMounted, setChatMounted] = createSignal(false);
  const chatId = createUniqueId();
  let chatButton: HTMLButtonElement | undefined;
  const closeChat = () => {
    setChatOpen(false);
    chatButton?.focus();
  };
  const toggleChat = () => {
    if (chatOpen()) return closeChat();
    setChatMounted(true);
    setChatOpen(true);
  };
  const canChat = () => props.showChat !== false && !!callCtx.activeCallId();
  const teamShareLocked = () =>
    isConnecting() || !teamShare.canToggle() || teamShare.isPending();

  const detailsId = createUniqueId();
  let detailsButton: HTMLButtonElement | undefined;
  /** Details stays open underneath chat and returns when chat closes. */
  const detailsOpen = () => sidePanel.isOpen() && !(canChat() && chatOpen());
  const panelOpen = () => detailsOpen() || (canChat() && chatOpen());
  const closeDetails = () => {
    sidePanel.setIsOpen(false);
    detailsButton?.focus();
  };
  const toggleDetails = () => {
    if (chatOpen()) {
      setChatOpen(false);
      sidePanel.setIsOpen(true);
      return;
    }
    sidePanel.toggle();
  };

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

  const localDisplayName = () =>
    props.localName ||
    callCtx.room()?.localParticipant.name ||
    currentUserName();

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
    <div class="flex flex-col h-full min-h-0 @container/call touch:pb-(--mobile-content-inset-bottom)">
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        <div class="flex min-w-0 flex-1 flex-col">
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
                  {(participant) => (
                    <ScreenShareTile participant={participant} />
                  )}
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
                  isSpeaking={isLocalSpeaking()}
                  isConnecting={isConnecting()}
                  isAudioMuted={callCtx.isAudioMuted()}
                  isVideoMuted={callCtx.isVideoMuted()}
                  track={localVideoTrack()}
                  userId={localUserId()}
                  fallbackName={localDisplayName()}
                />
              }
            >
              {/* Remote participants grid */}
              <div
                class={`size-full grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden`}
              >
                <For each={participants()}>
                  {(participant) => (
                    <ParticipantTile participant={participant} />
                  )}
                </For>
              </div>

              {/* Local participant PIP (Google Meet style: small, bottom-right) */}
              <div class="absolute bottom-4 right-4 w-40 aspect-video shadow-lg z-10 sm:w-48">
                <LocalParticipantTile
                  class="min-h-0"
                  isSpeaking={isLocalSpeaking()}
                  isConnecting={isConnecting()}
                  isAudioMuted={callCtx.isAudioMuted()}
                  isVideoMuted={callCtx.isVideoMuted()}
                  track={localVideoTrack()}
                  userId={localUserId()}
                  fallbackName={localDisplayName()}
                  avatarSize="sm"
                />
              </div>
            </Show>
          </div>
        </div>
        <Show when={canChat() && chatMounted()}>
          <Show when={callCtx.activeCallId()} keyed>
            {(callId) => (
              <Suspense>
                <Show
                  when={props.guestChatSession}
                  keyed
                  fallback={
                    <CallChat
                      callId={callId}
                      id={chatId}
                      open={chatOpen()}
                      onClose={closeChat}
                    />
                  }
                >
                  {(session) => (
                    <GuestCallChat
                      callId={callId}
                      session={session}
                      id={chatId}
                      open={chatOpen()}
                      onClose={closeChat}
                    />
                  )}
                </Show>
              </Suspense>
            )}
          </Show>
        </Show>
        <CallDetailsPanel
          id={detailsId}
          open={detailsOpen()}
          onClose={closeDetails}
        />
      </div>
      <CallDetailsSections
        localUserId={localUserId()}
        localName={localDisplayName()}
        participants={participants()}
        inviteLink={props.inviteLink}
        teamSharing={
          callCtx.activeChannelId() !== null && props.showTeamSharing !== false
            ? {
                shared: sharedWithTeam(),
                disabled: teamShareLocked(),
                onToggle: () =>
                  fireAndForget(teamShare.toggle(), 'channel-call'),
              }
            : undefined
        }
      />
      {/* Settings expand over the tiles. On desktop the bar (and the chat composer
          beside it) is the call's last row, where the corner prompt sits, so the
          prompt waits. */}
      <div
        class="relative flex shrink-0 flex-col items-center gap-2 py-3"
        data-holds-prompts={isTouchDevice() ? undefined : ''}
        classList={{ '@min-[800px]/call:mr-90': panelOpen() }}
      >
        <div class="grid w-full grid-cols-[minmax(3.5rem,1fr)_minmax(0,36rem)_minmax(3.5rem,1fr)] items-center gap-2 px-2 @max-[500px]/call:grid-cols-[minmax(0,1fr)_auto]">
          <div class="col-start-2 flex min-w-0 justify-center @max-[500px]/call:col-start-1">
            <CallControls onLeave={props.onLeave} />
          </div>
          <div class="flex items-center gap-1 justify-self-end rounded-xl border border-edge-muted bg-panel p-1.5 shadow-sm @max-[500px]/call:p-1">
            <Button
              ref={detailsButton}
              size="icon-lg"
              aria-label={detailsOpen() ? 'Hide details' : 'Show details'}
              tooltip={{
                content: detailsOpen() ? 'Hide details' : 'Show details',
                placement: 'top',
              }}
              aria-pressed={detailsOpen()}
              aria-controls={detailsId}
              onClick={toggleDetails}
            >
              <SidePanelIcon class="rotate-180" />
            </Button>
            <Show when={canChat()}>
              <Button
                ref={chatButton}
                size="icon-lg"
                aria-label={chatOpen() ? 'Close chat' : 'Open chat'}
                tooltip={{
                  content: chatOpen() ? 'Close chat' : 'Open chat',
                  placement: 'top',
                }}
                aria-pressed={chatOpen()}
                aria-controls={chatId}
                onClick={toggleChat}
              >
                <ChatIcon />
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
