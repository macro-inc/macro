import {
  CallWorkPrompt,
  CallWorkTab,
  createCallWork,
} from '@app/features/agent-work/views/call-work';
import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
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
import Screencast from '@icon/system/regular/screencast.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { makePersisted } from '@solid-primitives/storage';
import { Avatar, Button, cn } from '@ui';
import type { RemoteParticipant } from 'livekit-client';
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
import { CallMoreMenu } from './CallControls/CallMoreMenu';
import { CallReactionMenu } from './CallControls/CallReactionMenu';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import { CallParticipantsList } from './CallParticipantsList';
import {
  LocalParticipantTile,
  ParticipantTile,
  ScreenShareTile,
} from './CallParticipantTiles';
import { CallReactionLayer } from './CallReactionLayer';
import { CallWaveform } from './CallWaveform';
import { createCallFullscreen } from './call-fullscreen';
import { createCallHotkeys } from './call-hotkeys';
import {
  type CallLayout,
  normalizeCallLayout,
  selectCallStageParticipant,
} from './call-layout';
import { createCallReactions } from './call-reactions';
import {
  CallChatPanel,
  type CallPanelTab,
} from './chat/components/CallChatPanel';
import { createControlsVisibility } from './create-controls-visibility';
import type { CallPanelState } from './discussion/CallDiscussionContent';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';

const CallChat = lazy(() => import('./chat/CallChat'));
const GuestCallChat = lazy(() => import('./chat/GuestCallChat'));

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
  const [callRoot, setCallRoot] = createSignal<HTMLDivElement>();
  const fullscreen = createCallFullscreen(callRoot);
  createCallHotkeys(callCtx, fullscreen);
  const reactions = createCallReactions(callCtx.room);
  const [reactionRoot, setReactionRoot] = createSignal<HTMLDivElement>();
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
  const [panelToggleFrame, setPanelToggleFrame] =
    createSignal<HTMLDivElement>();
  const panelToggleSize = createElementSize(panelToggleFrame);
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

  const [savedLayout, setSavedLayout] = makePersisted(
    createSignal<CallLayout>('auto'),
    {
      name: 'call.layout',
      deserialize: (value) => {
        try {
          return normalizeCallLayout(JSON.parse(value));
        } catch {
          return 'auto';
        }
      },
    }
  );
  const layout = () => (isMobile() ? 'auto' : savedLayout());
  const [hideParticipants, setHideParticipants] = createSignal(false);
  createEffect(
    on(hasAnyScreenShare, (sharing) => {
      if (!sharing) setHideParticipants(false);
    })
  );
  const showScreenShare = () =>
    hasAnyScreenShare() && (hideParticipants() || !focusedParticipant());
  const speakerLayout = () => layout() === 'speaker' || layout() === 'sidebar';
  const primary = () =>
    selectCallStageParticipant(
      participants(),
      (participant) => callCtx.isParticipantSpeaking(participant),
      isLocalSpeaking()
    );
  const remotePrimary = () => {
    const participant = primary();
    return participant === 'local' ? undefined : participant;
  };
  const spotlight = () =>
    speakerLayout() && !showScreenShare() && !focusedParticipant();
  const sideStrip = () =>
    layout() === 'sidebar' && !focusedParticipant() && !hideParticipants();
  const selfInGrid = () =>
    (layout() === 'grid' ||
      ((isMobile() || compactControls()) && !hasAnyScreenShare())) &&
    participants().length > 0 &&
    !focusedParticipant();
  const talking = () =>
    participants().find((participant) =>
      callCtx.isParticipantSpeaking(participant)
    ) ?? (isLocalSpeaking() ? 'local' : undefined);
  const talkingId = () => {
    const participant = talking();
    return participant === 'local'
      ? localUserId()
      : participant
        ? tryMacroId(participant.identity)
        : undefined;
  };
  const talkingName = () => {
    const participant = talking();
    return participant === 'local'
      ? t('calls.you')
      : participant?.name ||
          (participant ? getDisplayName(tryMacroId(participant.identity)) : '');
  };
  const LocalTile = (tile: {
    class?: string;
    avatarSize?: 'sm' | 'md';
    focusable?: boolean;
  }) => (
    <LocalParticipantTile
      class={tile.class}
      isSpeaking={isLocalSpeaking()}
      isConnecting={isConnecting()}
      isAudioMuted={callCtx.isAudioMuted()}
      isVideoMuted={callCtx.isVideoMuted()}
      track={localVideoTrack()}
      userId={localUserId()}
      identity={callCtx.room()?.localParticipant.identity}
      fallbackName={
        props.localName ||
        callCtx.room()?.localParticipant.name ||
        currentUserName()
      }
      isProgram={isProgramParticipant(
        callCtx.room()?.localParticipant.attributes
      )}
      avatarSize={tile.avatarSize}
      isFocused={focusedParticipant() === 'local'}
      onToggleFocus={
        tile.focusable === false
          ? undefined
          : () => toggleParticipantFocus('local')
      }
    />
  );

  const gridCols = () => {
    if (focusedParticipant() && focusedParticipant() !== 'local')
      return 'grid-cols-1';
    const count = participants().length + (selfInGrid() ? 1 : 0);
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div
      ref={setCallRoot}
      class={cn(
        'portal-scope relative flex h-full min-h-0 flex-col @container/call touch:pt-[var(--mobile-content-inset-top,0px)] touch:pb-(--mobile-content-inset-bottom) mobile:pb-0',
        fullscreen.active() && 'h-dvh w-dvw bg-surface'
      )}
      data-call-layout={layout()}
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
              <div
                ref={setReactionRoot}
                class={cn(
                  'relative flex min-h-0 flex-1',
                  sideStrip() ? 'flex-row gap-2' : 'flex-col'
                )}
              >
                {/* Screen share area */}
                <Show when={hasAnyScreenShare()}>
                  <div
                    class="flex-1 min-h-0 pt-2"
                    classList={{ hidden: !showScreenShare() }}
                  >
                    <div class="relative h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center">
                      <Show when={callCtx.isScreenSharing()}>
                        <div class="flex size-full flex-col items-center justify-center gap-3 p-4">
                          <Screencast class="size-10 text-accent" />
                          <p class="font-semibold">
                            {t('calls.youAreSharing')}
                          </p>
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
                      <Show when={hideParticipants() && talking()}>
                        <div class="absolute bottom-2 right-2 z-10 flex items-center gap-2 rounded-full bg-surface/90 px-2 py-1 text-sm">
                          <span class="size-6 shrink-0 rounded-full outline-2 -outline-offset-2 outline-success">
                            <Show
                              when={talkingId()}
                              fallback={
                                <Avatar size="fill">
                                  <Avatar.Fallback>
                                    {talkingName().charAt(0)}
                                  </Avatar.Fallback>
                                </Avatar>
                              }
                            >
                              {(id) => (
                                <UserIcon id={id()} size="fill" suppressClick />
                              )}
                            </Show>
                          </span>
                          <span>{talkingName()}</span>
                          <CallWaveform class="size-4" />
                        </div>
                      </Show>
                    </div>
                  </div>
                </Show>
                <Show when={spotlight()}>
                  <div class="min-h-0 flex-1 pt-2">
                    <Show
                      when={remotePrimary()}
                      fallback={<LocalTile class="size-full" />}
                    >
                      {(participant) => (
                        <ParticipantTile
                          participant={participant()}
                          isFocused={false}
                          hidden={false}
                          onToggleFocus={() =>
                            toggleParticipantFocus(participant())
                          }
                        />
                      )}
                    </Show>
                  </div>
                </Show>

                {/* Participants area; stays mounted while the screen share is maximized. */}
                <div
                  hidden={
                    (showScreenShare() && hideParticipants()) ||
                    (spotlight() && participants().length === 0)
                  }
                  class={cn(
                    sideStrip() && (showScreenShare() || spotlight())
                      ? 'w-48 shrink-0 min-h-0 overflow-y-auto'
                      : showScreenShare() || spotlight()
                        ? layout() === 'grid'
                          ? 'h-48 shrink-0'
                          : 'h-24 shrink-0'
                        : 'flex-1 min-h-0',
                    focusedParticipant() === 'local' && 'relative',
                    selfInGrid() && `grid ${gridCols()} auto-rows-fr gap-2`,
                    'pt-2 mobile:pt-0'
                  )}
                >
                  <Show
                    when={participants().length > 0}
                    fallback={<LocalTile class="size-full" focusable={false} />}
                  >
                    {/* Remote participants grid */}
                    <div
                      class={
                        selfInGrid()
                          ? 'contents'
                          : cn(
                              sideStrip() && (showScreenShare() || spotlight())
                                ? 'flex flex-col gap-2'
                                : showScreenShare() || spotlight()
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
                            sidebar={
                              sideStrip() && (showScreenShare() || spotlight())
                            }
                            filmstrip={
                              (showScreenShare() || spotlight()) && !sideStrip()
                            }
                            avatarSize={
                              focusedParticipant() === 'local' ||
                              showScreenShare() ||
                              spotlight()
                                ? 'sm'
                                : 'md'
                            }
                            isFocused={focusedParticipant() === participant}
                            hidden={
                              (spotlight() && primary() === participant) ||
                              (!!focusedParticipant() &&
                                focusedParticipant() !== 'local' &&
                                focusedParticipant() !== participant)
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
                      hidden={spotlight() && primary() === 'local'}
                      class={cn(
                        selfInGrid() ? 'relative min-h-0' : 'absolute z-10',
                        !selfInGrid() &&
                          (focusedParticipant() === 'local'
                            ? 'inset-0'
                            : 'bottom-4 right-4 w-48 aspect-video shadow-lg')
                      )}
                    >
                      <LocalTile class="size-full min-h-0" avatarSize="sm" />
                    </div>
                  </Show>
                </div>
                <CallReactionLayer
                  root={reactionRoot}
                  reactions={reactions.entries()}
                />
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
                  data-call-controls-row
                  class="grid w-full items-center mobile:w-fit mobile:grid-cols-[auto_auto] mobile:gap-2 mobile:px-[max(16px,var(--mobile-chrome-gutter))]"
                  style={
                    isMobile()
                      ? undefined
                      : {
                          'grid-template-columns': `minmax(min-content,1fr) auto minmax(${(panelToggleSize.width ?? (compactControls() ? 48 : 56)) + (compactControls() ? 8 : 12)}px,1fr)`,
                        }
                  }
                >
                  <Show when={!isMobile() && props.footerLeading}>
                    <div class="col-start-1 row-start-1 mr-2 justify-self-start">
                      {props.footerLeading}
                    </div>
                  </Show>
                  <div class="col-start-2 row-start-1 flex min-w-0 justify-center mobile:col-start-1">
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
                      <Show
                        when={
                          !isMobile() && !compactControls() && callCtx.room()
                        }
                      >
                        <CallReactionMenu
                          onReaction={(emoji) =>
                            fireAndForget(
                              reactions.send(emoji),
                              'call-reaction'
                            )
                          }
                          onOpenChange={setSettingsOpen}
                        />
                      </Show>
                      <Show when={!isMobile()}>
                        <CallMoreMenu
                          compact={compactControls()}
                          layout={layout()}
                          fullscreen={fullscreen.active()}
                          fullscreenAvailable={fullscreen.available()}
                          onFullscreen={() =>
                            fireAndForget(
                              fullscreen.toggle(),
                              'call-fullscreen'
                            )
                          }
                          onReaction={
                            callCtx.room()
                              ? (emoji) =>
                                  fireAndForget(
                                    reactions.send(emoji),
                                    'call-reaction'
                                  )
                              : undefined
                          }
                          onLayoutChange={(value) => {
                            const interaction =
                              beginInteraction('call.layout.change');
                            try {
                              setSavedLayout(value);
                            } finally {
                              interaction.end();
                            }
                          }}
                          hasScreenShare={hasAnyScreenShare()}
                          hideParticipants={hideParticipants()}
                          onHideParticipantsChange={(value) => {
                            const interaction = beginInteraction(
                              'call.participants.visibility'
                            );
                            try {
                              setHideParticipants(value);
                            } finally {
                              interaction.end();
                            }
                          }}
                          onOpenChange={setSettingsOpen}
                        />
                      </Show>
                    </CallControls>
                  </div>
                  <div
                    ref={setPanelToggleFrame}
                    class={cn(
                      isMobile() ? 'island' : 'menu-surface',
                      'col-start-3 row-start-1 flex justify-center justify-self-end rounded-full mobile:col-start-2',
                      isMobile() ? 'p-1.5' : 'p-2'
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
