import {
  CallWorkPrompt,
  CallWorkTab,
  createCallWork,
} from '@app/features/agent-work/views/call-work';
import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { DEFAULT_SIDE_PANEL_WIDTH } from '@components/app/side-panel/sizing';
import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CornersInIcon from '@icon/system/regular/corners-in.svg';
import CornersOutIcon from '@icon/system/regular/corners-out.svg';
import Screencast from '@icon/system/regular/screencast.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Badge, Button, cn } from '@ui';
import type { RemoteParticipant, Track } from 'livekit-client';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSXElement,
  lazy,
  Match,
  on,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import { CallParticipantsList } from './CallParticipantsList';
import {
  CallChatPanel,
  type CallPanelTab,
} from './chat/components/CallChatPanel';
import { createControlsVisibility } from './create-controls-visibility';
import type { CallPanelState } from './discussion/CallDiscussionContent';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { MutedMicrophoneBadge } from './MutedMicrophoneBadge';
import { TrackView } from './TrackView';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

const CallChat = lazy(() => import('./chat/CallChat'));
const GuestCallChat = lazy(() => import('./chat/GuestCallChat'));

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

function LocalParticipantTile(props: {
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

function ParticipantTile(props: {
  participant: RemoteParticipant;
  avatarSize?: 'sm' | 'md';
  filmstrip?: boolean;
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

      <VideoTag
        variant="truncated"
        isProgram={isProgramParticipant(props.participant.attributes)}
      >
        <span class="flex items-center gap-1.5">
          <Show when={macroId()}>
            {(id) => (
              <span class="size-5 shrink-0">
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

export function CallOverlay(props: {
  onLeave: () => void;
  showTeamSharing?: boolean;
  sharingChannelName?: string;
  sharedWithTeam?: boolean;
  localName?: string;
  /** The host may hide chat until account or guest session credentials are ready. */
  showChat?: boolean;
  /** Host-owned action aligned to the left of the media controls. */
  footerLeading?: JSXElement;
  /** Narrow RTC credential for a guest; never an account bearer. */
  guestChatSession?: { token: string; participantId: string };
  /** The host's own discussion, in place of the call's chat. */
  discussion?: {
    /** Names the panel's discussion tab. */
    label: () => string | undefined;
    /** Open the panel as soon as this turns true. */
    opensByDefault: () => boolean;
    /** There's news for someone whose panel is closed. */
    hasUpdates: () => boolean;
    render: (panel: CallPanelState) => JSXElement;
  };
}) {
  const callCtx = useCallContext();
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const teamShare = useActiveCallTeamShare();
  const sharedWithTeam = () =>
    props.sharedWithTeam ?? callCtx.isSharedWithTeam();
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [panelMounted, setPanelMounted] = createSignal(false);
  const [selectedTab, setSelectedTab] = createSignal<CallPanelTab>('chat');
  const [focusChatOnOpen, setFocusChatOnOpen] = createSignal(true);
  const [resizeContext, setResizeContext] = createSignal<ResizeZoneCtx>();
  const [panelWidth, setPanelWidth] = createSignal(DEFAULT_SIDE_PANEL_WIDTH);
  const [sidebarMount, setSidebarMount] = createSignal<HTMLDivElement>();
  const [overlayMount, setOverlayMount] = createSignal<HTMLDivElement>();
  const widePanel = () => !isMobile() && (resizeContext()?.size() ?? 0) >= 800;
  const stageWidth = () =>
    (resizeContext()?.size() ?? 0) -
    (panelOpen() && widePanel() ? panelWidth() + 12 : 0);
  const compactControls = () => !isMobile() && stageWidth() < 640;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [sharingOpen, setSharingOpen] = createSignal(false);
  const [keyboardFocus, setKeyboardFocus] = createSignal(false);
  const controls = createControlsVisibility({
    // Keep controls visible until idle hiding is reintroduced.
    enabled: () => false,
    keepVisible: () =>
      panelOpen() ||
      settingsOpen() ||
      sharingOpen() ||
      keyboardFocus() ||
      virtualKeyboardVisible(),
  });
  const controlsHidden = () => isMobile() && !controls.visible();
  const panelId = createUniqueId();
  let panelButton: HTMLButtonElement | undefined;
  const closePanel = () => {
    setPanelOpen(false);
    panelButton?.focus();
  };
  createEffect(
    on(
      () => props.discussion?.opensByDefault() ?? false,
      (opensByDefault) => {
        if (!opensByDefault) return;
        setFocusChatOnOpen(false);
        setPanelMounted(true);
        setPanelOpen(true);
      }
    )
  );
  const togglePanel = () => {
    if (panelOpen()) return closePanel();
    setFocusChatOnOpen(true);
    setPanelMounted(true);
    setPanelOpen(true);
  };
  const canChat = () => props.showChat !== false && !!callCtx.activeCallId();
  const canShareWithTeam = () =>
    callCtx.activeChannelId() !== null && props.showTeamSharing !== false;
  const teamShareLocked = () =>
    isConnecting() || !teamShare.canToggle() || teamShare.isPending();

  const PanelToggle = () => (
    <Button
      ref={panelButton}
      class="relative"
      variant={panelOpen() ? 'accent' : 'secondary'}
      size={compactControls() ? 'icon-md' : 'icon-lg'}
      aria-label={panelOpen() ? t('calls.closePanel') : t('calls.openPanel')}
      tooltip={{
        content: panelOpen() ? t('calls.closePanel') : t('calls.openPanel'),
        placement: 'top',
      }}
      aria-expanded={panelOpen()}
      aria-controls={panelId}
      onClick={togglePanel}
    >
      <Show
        when={canChat()}
        fallback={<UsersIcon class="size-4 mobile:size-6" />}
      >
        <ChatIcon class="size-4 mobile:size-6" />
      </Show>
      <Show
        when={
          callWork.showButtonDot() ||
          (!panelOpen() && props.discussion?.hasUpdates())
        }
      >
        <span
          aria-hidden="true"
          class="absolute top-1 right-1 size-1.5 rounded-full bg-accent"
        />
      </Show>
    </Button>
  );

  const participants = () =>
    Array.from(callCtx.remoteParticipants().values()).filter((p) => !p.isAgent);

  const callWork = createCallWork({
    accountIds: () =>
      participants().map((participant) => tryMacroId(participant.identity)),
    selectedTab,
    panelOpen,
    canChat,
  });
  const work = callWork.work;
  const hasWork = callWork.hasWork;
  const activeTab = callWork.activeTab;
  const workArrivals = callWork.arrivals;
  const workTab = () => {
    if (!hasWork()) return undefined;

    return (
      <CallWorkTab
        accounts={work.accountsWithWork()}
        itemsFor={(id) => work.byAccount().get(id) ?? []}
        isSpeaking={isAccountSpeaking}
      />
    );
  };
  const openWork = () => {
    workArrivals.dismiss();
    setFocusChatOnOpen(false);
    setSelectedTab('work');
    setPanelMounted(true);
    setPanelOpen(true);
  };

  const [selectedParticipant, setSelectedParticipant] = createSignal<
    RemoteParticipant | 'local'
  >();
  createEffect(() => {
    if (participants().length === 0) setSelectedParticipant(undefined);
  });
  const focusedParticipant = () => {
    const selected = selectedParticipant();
    return selected === 'local' ||
      (selected && participants().includes(selected))
      ? selected
      : undefined;
  };
  const toggleParticipantFocus = (participant: RemoteParticipant | 'local') =>
    setSelectedParticipant((selected) =>
      selected === participant ? undefined : participant
    );

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

  const remoteScreenShares = () => {
    callCtx.trackVersion();
    return participants().filter((p) => {
      const pub = p.getTrackPublication(LK_TRACK_SOURCE.ScreenShare);
      return !!pub?.track && pub.isSubscribed && !pub.isMuted;
    });
  };

  const isAccountSpeaking = (accountId: string) => {
    const participant = participants().find(
      (candidate) => tryMacroId(candidate.identity) === accountId
    );
    return participant ? callCtx.isParticipantSpeaking(participant) : false;
  };

  const hasAnyScreenShare = () =>
    callCtx.isScreenSharing() || remoteScreenShares().length > 0;

  const [screenShareMaximized, setScreenShareMaximized] = createSignal(false);
  const showScreenShare = () => hasAnyScreenShare() && !focusedParticipant();
  const selfInGrid = () =>
    (isMobile() || compactControls()) &&
    participants().length > 0 &&
    !hasAnyScreenShare() &&
    !focusedParticipant();
  const maximizeLabel = () =>
    screenShareMaximized()
      ? t('calls.restoreScreenShare')
      : t('calls.maximizeScreenShare');

  const gridCols = () => {
    if (focusedParticipant() && focusedParticipant() !== 'local')
      return 'grid-cols-1';
    const count = participants().length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div
      class="relative flex h-full min-h-0 flex-col @container/call touch:pt-[var(--mobile-content-inset-top,0px)] touch:pb-(--mobile-content-inset-bottom) mobile:pb-0"
      data-call-fullscreen={isMobile() ? '' : undefined}
      onPointerDown={() => {
        setKeyboardFocus(false);
        controls.reveal();
      }}
      onKeyDown={() => {
        setKeyboardFocus(true);
        controls.reveal();
      }}
      onFocusIn={(event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.matches(':focus-visible')
        ) {
          setKeyboardFocus(true);
        }
      }}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setKeyboardFocus(false);
      }}
    >
      {/* The call owns its controls instead of the mobile New action. */}
      <FloatRegion region="accessory" />
      <FloatRegion region="dock" priority={100} active={isMobile} />
      <div
        ref={setOverlayMount}
        class="relative min-h-0 flex-1 overflow-hidden px-3 pb-3 mobile:px-0 mobile:pb-0"
      >
        <Resize.Zone
          direction="horizontal"
          gutter={12}
          showDividers={false}
          captureResizeCtx={setResizeContext}
          class={cn(
            // Hidden resize panels reset their left offset; keep chat at the right edge.
            '[&>[data-resize-panel]:has(>[data-call-sidebar])]:left-auto! [&>[data-resize-panel]:has(>[data-call-sidebar])]:right-0',
            !isMobile() &&
              panelMounted() && [
                '[&>[data-resize-panel]]:transition-[width] [&>[data-resize-panel]]:duration-200 [&>[data-resize-panel]]:ease-out [&>[data-resize-panel]]:motion-reduce:transition-none',
                '[&>[role=separator]]:transition-[left] [&>[role=separator]]:duration-200 [&>[role=separator]]:ease-out [&>[role=separator]]:motion-reduce:transition-none',
                '[&:has(>[role=separator]:active)>*]:transition-none',
              ]
          )}
        >
          <Resize.Panel id="call-stage" minSize={widePanel() ? 320 : 0}>
            <div class="relative flex h-full min-h-0 min-w-0 flex-col @container/call-stage">
              {/* Screen share area */}
              <Show when={hasAnyScreenShare()}>
                <div
                  class="flex-1 min-h-0 pt-2"
                  classList={{ hidden: !!focusedParticipant() }}
                >
                  <div class="relative h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
                    <Button
                      class="absolute right-2 top-2 z-10"
                      variant="secondary"
                      size="icon-sm"
                      aria-label={maximizeLabel()}
                      tooltip={{ content: maximizeLabel(), placement: 'left' }}
                      onClick={() => setScreenShareMaximized((value) => !value)}
                    >
                      <Show
                        when={screenShareMaximized()}
                        fallback={<CornersOutIcon class="size-4" />}
                      >
                        <CornersInIcon class="size-4" />
                      </Show>
                    </Button>
                    <Show when={callCtx.isScreenSharing()}>
                      <div class="flex size-full flex-col items-center justify-center gap-3 p-4">
                        <Screencast class="size-10 text-accent" />
                        <p class="font-semibold">{t('calls.youAreSharing')}</p>
                        <p class="text-sm text-ink-muted">
                          {t('calls.everyoneCanSee')}
                        </p>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            fireAndForget(
                              callCtx.toggleScreenShare(),
                              'channel-call'
                            )
                          }
                        >
                          <Screencast class="size-4" />
                          {t('calls.stopSharing')}
                        </Button>
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

              {/* Participants area; stays mounted while the screen share is maximized. */}
              <div
                hidden={showScreenShare() && screenShareMaximized()}
                class={`${showScreenShare() ? 'h-24 shrink-0' : 'flex-1 min-h-0'} ${focusedParticipant() === 'local' ? 'relative' : ''} ${selfInGrid() ? 'grid grid-cols-2 auto-rows-fr gap-2' : ''} pt-2 mobile:pt-0`}
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
                      fallbackName={
                        props.localName ||
                        callCtx.room()?.localParticipant.name ||
                        currentUserName()
                      }
                      isProgram={isProgramParticipant(
                        callCtx.room()?.localParticipant.attributes
                      )}
                      isFocused={focusedParticipant() === 'local'}
                    />
                  }
                >
                  {/* Remote participants grid */}
                  <div
                    class={
                      selfInGrid()
                        ? 'contents'
                        : cn(
                            showScreenShare()
                              ? 'flex h-full justify-center gap-2 overflow-hidden'
                              : `grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden`,
                            focusedParticipant() === 'local'
                              ? 'absolute bottom-4 right-4 z-20 w-40 aspect-video shadow-lg sm:w-48'
                              : 'size-full'
                          )
                    }
                  >
                    <For each={participants()}>
                      {(participant) => (
                        <ParticipantTile
                          participant={participant}
                          filmstrip={showScreenShare()}
                          avatarSize={
                            focusedParticipant() === 'local' ||
                            showScreenShare()
                              ? 'sm'
                              : 'md'
                          }
                          isFocused={focusedParticipant() === participant}
                          hidden={
                            !!focusedParticipant() &&
                            focusedParticipant() !== 'local' &&
                            focusedParticipant() !== participant
                          }
                          onToggleFocus={() =>
                            toggleParticipantFocus(participant)
                          }
                        />
                      )}
                    </For>
                  </div>

                  <Show when={callWork.showPrompt()}>
                    <CallWorkPrompt
                      accounts={work.accountsWithWork()}
                      onView={openWork}
                      onDismiss={workArrivals.dismiss}
                    />
                  </Show>

                  {/* Local participant PIP (Google Meet style: small, bottom-right) */}
                  <div
                    class={cn(
                      selfInGrid() ? 'relative min-h-0' : 'absolute z-10',
                      !selfInGrid() &&
                        (focusedParticipant() === 'local'
                          ? 'inset-0'
                          : `right-4 w-48 aspect-video shadow-lg ${(panelOpen() && widePanel()) || stageWidth() < 980 ? 'bottom-24' : 'bottom-4'}`)
                    )}
                  >
                    <LocalParticipantTile
                      class="size-full min-h-0"
                      isSpeaking={isLocalSpeaking()}
                      isConnecting={isConnecting()}
                      isAudioMuted={callCtx.isAudioMuted()}
                      isVideoMuted={callCtx.isVideoMuted()}
                      track={localVideoTrack()}
                      userId={localUserId()}
                      fallbackName={
                        props.localName ||
                        callCtx.room()?.localParticipant.name ||
                        currentUserName()
                      }
                      isProgram={isProgramParticipant(
                        callCtx.room()?.localParticipant.attributes
                      )}
                      avatarSize="sm"
                      isFocused={focusedParticipant() === 'local'}
                      onToggleFocus={() => toggleParticipantFocus('local')}
                    />
                  </div>
                </Show>
              </div>
              {/* Settings expand over the tiles; the chat keeps its own full-height column. */}
              <div
                class="relative flex shrink-0 flex-col items-center gap-2 py-3 mobile:pb-[calc(var(--safe-bottom,0px)+12px)] transition-opacity duration-200 motion-reduce:transition-none"
                classList={{
                  'opacity-0 invisible pointer-events-none': controlsHidden(),
                }}
                inert={controlsHidden()}
                data-holds-prompts={isTouchDevice() ? undefined : ''}
              >
                <div
                  class={cn(
                    'grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center mobile:w-fit mobile:grid-cols-[minmax(0,1fr)_auto] mobile:gap-2 mobile:px-[max(16px,var(--mobile-chrome-gutter))]',
                    compactControls() ? 'gap-2' : 'gap-3'
                  )}
                >
                  <div
                    aria-hidden={!props.footerLeading}
                    class="min-w-0 justify-self-end mobile:hidden"
                  >
                    {props.footerLeading}
                  </div>
                  <div class="flex min-w-0 justify-center">
                    <CallControls
                      compact={compactControls()}
                      onLeave={props.onLeave}
                      onSettingsOpenChange={setSettingsOpen}
                    >
                      <Show when={canShareWithTeam()}>
                        <CallSharingMenu
                          compact={compactControls()}
                          channelName={props.sharingChannelName}
                          sharedWithTeam={sharedWithTeam()}
                          disabled={teamShareLocked()}
                          onToggle={() =>
                            fireAndForget(teamShare.toggle(), 'channel-call')
                          }
                          onOpenChange={setSharingOpen}
                        />
                      </Show>
                    </CallControls>
                  </div>
                  <div
                    class={cn(
                      isMobile() ? 'island' : 'menu-surface',
                      'flex justify-center justify-self-start rounded-full p-1.5'
                    )}
                  >
                    <PanelToggle />
                  </div>
                </div>
              </div>
            </div>
          </Resize.Panel>
          <Resize.Panel
            id="call-sidebar"
            minSize={280}
            maxSize={480}
            target={{ kind: 'px', px: DEFAULT_SIDE_PANEL_WIDTH }}
            redistributionPreferredSize={panelWidth()}
            onSizeChangeEnd={setPanelWidth}
            hidden={() => !widePanel() || !panelOpen()}
            persistent
          >
            <div ref={setSidebarMount} data-call-sidebar class="h-full py-2" />
          </Resize.Panel>
        </Resize.Zone>
        <Show when={panelMounted()}>
          <CallChatPanel
            id={panelId}
            open={panelOpen()}
            onClose={closePanel}
            activeTab={activeTab()}
            onTabChange={(tab) => {
              setFocusChatOnOpen(false);
              setSelectedTab(tab);
            }}
            chatAvailable={canChat()}
            participantCount={participants().length + 1}
            participants={<CallParticipantsList localName={props.localName} />}
            work={workTab()}
            workDot={callWork.showTabDot()}
            sidebarMount={widePanel() ? sidebarMount() : undefined}
            overlayMount={overlayMount()}
            returnFocus={panelButton}
            discussionLabel={props.discussion?.label()}
          >
            <Show when={canChat() && callCtx.activeCallId()} keyed>
              {(callId) => (
                <Suspense>
                  <Switch
                    fallback={
                      <CallChat
                        callId={callId}
                        open={panelOpen() && activeTab() === 'chat'}
                        focusOnOpen={focusChatOnOpen()}
                        onClose={closePanel}
                      />
                    }
                  >
                    <Match when={props.discussion}>
                      {(discussion) =>
                        discussion().render({
                          get open() {
                            return panelOpen() && activeTab() === 'chat';
                          },
                          get focusOnOpen() {
                            return focusChatOnOpen();
                          },
                          onClose: closePanel,
                        })
                      }
                    </Match>
                    <Match when={props.guestChatSession} keyed>
                      {(session) => (
                        <GuestCallChat
                          callId={callId}
                          session={session}
                          open={panelOpen() && activeTab() === 'chat'}
                          focusOnOpen={focusChatOnOpen()}
                          onClose={closePanel}
                        />
                      )}
                    </Match>
                  </Switch>
                </Suspense>
              )}
            </Show>
          </CallChatPanel>
        </Show>
      </div>
    </div>
  );
}
