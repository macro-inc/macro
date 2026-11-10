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
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Avatar, Button, cn, Dropdown } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSXElement,
  lazy,
  Match,
  on,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useCallContext } from './CallContext';
import { CallControls } from './CallControls/CallControls';
import { CallSharingMenu } from './CallControls/CallSharingMenu';
import { CallParticipantsList } from './CallParticipantsList';
import { CallChatPanel } from './chat/components/CallChatPanel';
import { CallMoreMenu } from './components/CallMoreMenu';
import { CallReactionLayer } from './components/CallReactionLayer';
import { CallReactionMenu } from './components/CallReactionMenu';
import { CallWaveform } from './components/CallWaveform';
import { callStageGridStyle } from './core/call-layout';
import { createControlsVisibility } from './create-controls-visibility';
import type { CallPanelState } from './discussion/CallDiscussionContent';
import { isProgramParticipant } from './is-program-participant';
import { LK_TRACK_SOURCE } from './livekit-loader';
import { createCallFullscreen } from './primitives/call-fullscreen';
import { createCallHotkeys } from './primitives/call-hotkeys';
import { createCallPanel } from './primitives/create-call-panel';
import { createCallReactions } from './primitives/create-call-reactions';
import { createCallStage } from './primitives/create-call-stage';
import { useActiveCallTeamShare } from './use-toggle-share-with-team';
import {
  LocalParticipantTile,
  LocalScreenShareTile,
  ParticipantTile,
  ScreenShareTile,
} from './views/CallParticipantTiles';
import {
  CallFullscreenPortal,
  useCallFullscreenOptional,
} from './views/call-fullscreen-host';

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
  const fullscreen =
    useCallFullscreenOptional()?.fullscreen ?? createCallFullscreen(callRoot);
  const [attachCallScope, callScope] = useHotkeyDOMScope('call');
  createCallHotkeys(callCtx, fullscreen, callScope);
  const reactions = createCallReactions(callCtx.room);
  const [reactionRoot, setReactionRoot] = createSignal<HTMLDivElement>();
  const currentUserId = useUserId();
  const currentUserName = useAuthor();
  const isConnecting = () => callCtx.isConnecting();
  const teamShare = useActiveCallTeamShare();
  const sharedWithTeam = () =>
    props.sharedWithTeam ?? callCtx.isSharedWithTeam();
  let panelButton: HTMLButtonElement | undefined;
  const panel = createCallPanel(
    () => props.discussion?.opensByDefault() ?? false,
    () => panelButton?.focus()
  );
  const panelOpen = () => panel.state.open;
  const panelMounted = () => panel.state.mounted;
  const selectedTab = () => panel.state.tab;
  const focusChatOnOpen = () => panel.state.focusOnOpen;
  const setSelectedTab = panel.selectTab;
  const [resizeContext, setResizeContext] = createSignal<ResizeZoneCtx>();
  const [entranceReady, setEntranceReady] = createSignal(false);
  createEffect(
    on(
      () => resizeContext()?.size() ?? 0,
      (width) => {
        if (width <= 0 || entranceReady()) return;
        let frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setEntranceReady(true));
        });
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );
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
  const [panelToggleFrame, setPanelToggleFrame] =
    createSignal<HTMLDivElement>();
  const panelToggleSize = createElementSize(panelToggleFrame);
  const closePanel = panel.close;
  const togglePanel = panel.toggle;
  const canChat = () => props.showChat !== false && !!callCtx.activeCallId();
  const canShareWithTeam = () =>
    callCtx.activeChannelId() !== null && props.showTeamSharing !== false;
  const teamShareLocked = () =>
    isConnecting() || !teamShare.canToggle() || teamShare.isPending();

  const PanelToggle = () => (
    <Button
      ref={panelButton}
      class={cn(
        'relative',
        !isMobile() && !panelOpen() && 'menu-surface text-ink'
      )}
      variant={panelButtonVariant()}
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
        fallback={<UsersIcon class="size-5 mobile:size-6" />}
      >
        <ChatIcon class="size-5 mobile:size-6" />
      </Show>
      <Show
        when={
          callWork.showButtonDot() ||
          (!panelOpen() && props.discussion?.hasUpdates())
        }
      >
        <span
          aria-hidden="true"
          class="absolute top-[15%] right-[15%] size-1.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
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
  const workTab = createMemo(() => {
    if (!hasWork()) return undefined;

    return (
      <CallWorkTab
        accounts={work.accountsWithWork()}
        itemsFor={(id) => work.byAccount().get(id) ?? []}
        isSpeaking={isAccountSpeaking}
      />
    );
  });
  const openWork = () => {
    workArrivals.dismiss();
    panel.open(false, 'work');
  };

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

  function isAccountSpeaking(accountId: string) {
    const participant = participants().find(
      (candidate) => tryMacroId(candidate.identity) === accountId
    );
    return participant ? callCtx.isParticipantSpeaking(participant) : false;
  }

  const {
    activePin,
    togglePin,
    hasAnyScreenShare,
    layout,
    setSavedLayout,
    hideParticipants,
    changeParticipantVisibility,
    pinnedShare,
    pinnedPerson,
    showScreenShare,
    spotlight,
    staged,
    isStage,
    sideStrip,
    stagePerson,
    localOnStage,
    selfInGrid,
    stripTargets,
    tilePosition,
  } = createCallStage({
    participants,
    screens: remoteScreenShares,
    screenSharing: callCtx.isScreenSharing,
    isSpeaking: callCtx.isParticipantSpeaking,
    localSpeaking: isLocalSpeaking,
    mobile: isMobile,
    compact: compactControls,
  });

  const talking = () =>
    participants().find((participant) =>
      callCtx.isParticipantSpeaking(participant)
    ) ?? (isLocalSpeaking() ? 'local' : undefined);
  const talkingId = () => {
    const participant = talking();
    if (participant === 'local') return localUserId();
    if (!participant) return undefined;
    return tryMacroId(participant.identity);
  };
  const talkingName = () => {
    const participant = talking();
    return participant === 'local'
      ? t('calls.you')
      : participant?.name ||
          (participant ? getDisplayName(tryMacroId(participant.identity)) : '');
  };
  const stageClass = () => {
    if (staged()) return 'grid justify-center gap-2';
    return sideStrip() ? 'flex-row gap-2' : 'flex-col';
  };
  const stageStyle = () => {
    if (!staged()) return undefined;
    return callStageGridStyle(
      stripTargets().length,
      sideStrip(),
      hideParticipants()
    );
  };
  const slotClass = (onStage: boolean) => {
    if (!staged()) return undefined;
    if (onStage)
      return sideStrip()
        ? 'col-start-1 row-start-1'
        : 'col-span-full row-start-1';
    return sideStrip() ? 'col-start-2' : 'row-start-2';
  };
  const edgeStyle = () => {
    if (hideParticipants()) return undefined;
    if (sideStrip()) return { right: 'calc(9rem + 1rem)' };
    return { bottom: 'calc(6rem + 1rem)' };
  };
  const edgeIcon = () => {
    if (layout() === 'sidebar')
      return hideParticipants() ? CaretLeft : CaretRight;
    return hideParticipants() ? CaretUp : CaretDown;
  };
  const participantAreaClass = () => {
    if (staged()) return 'contents';
    if (!showScreenShare() && !spotlight()) return 'flex-1 min-h-0';
    if (sideStrip()) return 'w-48 shrink-0 min-h-0 overflow-y-auto';
    return layout() === 'grid' ? 'h-48 shrink-0' : 'h-24 shrink-0';
  };
  const remoteGridClass = () => {
    if (staged() || selfInGrid()) return 'contents';
    if (!showScreenShare())
      return `grid ${gridCols()} gap-2 auto-rows-fr overflow-hidden size-full`;
    if (sideStrip())
      return 'flex h-full flex-col items-center gap-2 overflow-y-auto size-full';
    return 'flex h-full justify-center gap-2 overflow-hidden size-full';
  };
  const smallParticipant = (participant: ReturnType<typeof stagePerson>) => {
    const inStrip = staged() && stagePerson() !== participant;
    return inStrip || showScreenShare();
  };
  const selfPositionClass = () => {
    if (localOnStage()) return cn(slotClass(true), 'min-h-0');
    if (!selfInGrid())
      return 'absolute z-10 bottom-4 right-4 w-48 aspect-video shadow-lg';
    return staged() ? 'row-start-2 min-h-0' : 'relative min-h-0';
  };
  const controlsRowStyle = () => {
    if (isMobile()) return undefined;
    const toggleWidth = panelToggleSize.width ?? (compactControls() ? 32 : 40);
    const gap = compactControls() ? 8 : 12;
    return {
      'grid-template-columns': `minmax(min-content,1fr) auto minmax(${toggleWidth + gap}px,1fr)`,
    };
  };
  const sendReaction = (emoji: Parameters<typeof reactions.send>[0]) => {
    fireAndForget(reactions.send(emoji), 'call-reaction');
  };
  const reactionAction = () => {
    if (!callCtx.room()) return undefined;
    return sendReaction;
  };
  const panelButtonVariant = () => {
    if (!panelOpen()) return 'secondary';
    return isMobile() ? 'accent' : 'primary';
  };
  const LocalTile = (tile: {
    class?: string;
    avatarSize?: 'sm' | 'md';
    pinEnabled?: boolean;
  }) => (
    <LocalParticipantTile
      class={tile.class}
      stage={localOnStage()}
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
      isPinned={activePin() === 'local'}
      pinEnabled={tile.pinEnabled !== false}
      onTogglePin={() => togglePin('local')}
    />
  );

  const gridCols = () => {
    const count = participants().length + (selfInGrid() ? 1 : 0);
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <CallFullscreenPortal>
      <div
        ref={(element) => {
          setCallRoot(element);
          attachCallScope(element);
        }}
        tabIndex={-1}
        class={cn(
          'portal-scope relative flex h-full min-h-0 flex-col @container/call touch:pt-[var(--mobile-content-inset-top,0px)] touch:pb-(--mobile-content-inset-bottom) mobile:pb-0',
          fullscreen.active() && 'h-dvh w-dvw bg-surface',
          'transition-opacity duration-150 motion-reduce:transition-none',
          !entranceReady() && 'opacity-0'
        )}
        data-call-layout={layout()}
        data-call-fullscreen={isMobile() ? '' : undefined}
        onPointerDown={(event) => {
          // A stage click owns Space; clicks in other panes keep their own scope.
          const root = event.currentTarget;
          if (!root.contains(document.activeElement)) {
            root.focus({ preventScroll: true });
          }
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
          class="relative min-h-0 flex-1 overflow-hidden"
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
                panelMounted() &&
                entranceReady() && [
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
                  data-call-participant-stage
                  class={cn(
                    'relative flex min-h-0 flex-1',
                    stageClass(),
                    sideStrip() && staged() && 'overflow-hidden'
                  )}
                  style={stageStyle()}
                >
                  {/* Screen share area */}
                  <Show when={hasAnyScreenShare()}>
                    <div
                      class={cn(
                        'flex-1 min-h-0',
                        staged() ? 'contents' : 'pt-2'
                      )}
                      classList={{ hidden: !showScreenShare() && !staged() }}
                    >
                      <div
                        class={cn(
                          'group/share relative h-full rounded-lg overflow-hidden bg-surface-2 flex items-center justify-center',
                          staged() && 'contents'
                        )}
                      >
                        <Show when={callCtx.isScreenSharing()}>
                          <div
                            hidden={
                              staged() &&
                              hideParticipants() &&
                              !isStage('local-share')
                            }
                            class={cn(
                              'min-h-0 min-w-0 size-full',
                              slotClass(activePin() === 'local-share')
                            )}
                            style={tilePosition('local-share')}
                          >
                            <LocalScreenShareTile
                              isPinned={activePin() === 'local-share'}
                              inStrip={staged() && !isStage('local-share')}
                              pinEnabled
                              onTogglePin={() => togglePin('local-share')}
                            />
                          </div>
                        </Show>
                        <For each={remoteScreenShares()}>
                          {(participant) => (
                            <div
                              hidden={
                                staged() &&
                                hideParticipants() &&
                                !isStage({ share: participant })
                              }
                              class={cn(
                                'min-w-0 min-h-0',
                                !staged() && 'flex-1',
                                slotClass(pinnedShare() === participant)
                              )}
                              style={tilePosition({ share: participant })}
                            >
                              <ScreenShareTile
                                participant={participant}
                                isPinned={pinnedShare() === participant}
                                inStrip={
                                  staged() && !isStage({ share: participant })
                                }
                                pinEnabled
                                onTogglePin={() =>
                                  togglePin({ share: participant })
                                }
                              />
                            </div>
                          )}
                        </For>
                        <Show when={hideParticipants() && talking()}>
                          <div
                            data-call-stage-chip="speaker"
                            class="absolute bottom-2 right-2 z-10 flex items-center gap-2 rounded-full bg-surface/90 px-2 py-1 text-sm"
                          >
                            <CallWaveform class="size-4 shrink-0" />
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
                                  <UserIcon
                                    id={id()}
                                    size="fill"
                                    suppressClick
                                  />
                                )}
                              </Show>
                            </span>
                            <span>{talkingName()}</span>
                          </div>
                        </Show>
                        <Show
                          when={
                            !isMobile() && layout() !== 'grid' && !activePin()
                          }
                        >
                          <Button
                            appearance="bare"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={
                              hideParticipants()
                                ? t('calls.showParticipants')
                                : t('calls.hideParticipants')
                            }
                            aria-expanded={!hideParticipants()}
                            tooltip={{
                              content: hideParticipants()
                                ? t('calls.showParticipants')
                                : t('calls.hideParticipants'),
                              placement:
                                layout() === 'sidebar' ? 'left' : 'top',
                            }}
                            style={edgeStyle()}
                            class={cn(
                              'absolute z-20 rounded-full border border-edge-muted bg-surface/70 text-ink opacity-0 pointer-events-none group-hover/share:opacity-100 group-hover/share:pointer-events-auto group-focus-within/share:opacity-100 group-focus-within/share:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto',
                              layout() === 'sidebar'
                                ? 'right-2 top-1/2 -translate-y-1/2 h-11 w-6'
                                : 'bottom-2 left-1/2 -translate-x-1/2 h-6 w-11'
                            )}
                            onClick={() =>
                              changeParticipantVisibility(!hideParticipants())
                            }
                          >
                            <Dynamic component={edgeIcon()} class="size-4" />
                          </Button>
                        </Show>
                      </div>
                    </div>
                  </Show>
                  {/* Participants area; stays mounted while the screen share is maximized. */}
                  <div
                    hidden={
                      (showScreenShare() && hideParticipants()) ||
                      (spotlight() && participants().length === 0)
                    }
                    class={cn(
                      participantAreaClass(),

                      !staged() &&
                        selfInGrid() &&
                        `grid ${gridCols()} auto-rows-fr gap-2`,
                      !staged() && 'pt-2 mobile:pt-0'
                    )}
                  >
                    <Show
                      when={participants().length > 0}
                      fallback={
                        <LocalTile class="size-full" pinEnabled={false} />
                      }
                    >
                      {/* Remote participants grid */}
                      <div class={remoteGridClass()}>
                        <For each={participants()}>
                          {(participant) => (
                            <div
                              class={cn(
                                'min-h-0 min-w-0',
                                !staged() &&
                                  (showScreenShare()
                                    ? 'flex-1 max-w-36'
                                    : 'size-full'),
                                slotClass(stagePerson() === participant)
                              )}
                              style={tilePosition(participant)}
                            >
                              <ParticipantTile
                                participant={participant}
                                stage={
                                  staged() && stagePerson() === participant
                                }
                                sidebar={
                                  sideStrip() && stagePerson() !== participant
                                }
                                filmstrip={smallParticipant(participant)}
                                avatarSize={
                                  smallParticipant(participant) ? 'sm' : 'md'
                                }
                                isPinned={pinnedPerson() === participant}
                                hidden={false}
                                pinEnabled
                                onTogglePin={() => togglePin(participant)}
                              />
                            </div>
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

                      {/* Auto alone uses a floating self view; other layouts own a tile. */}
                      <div
                        hidden={false}
                        style={tilePosition('local')}
                        class={selfPositionClass()}
                      >
                        <LocalTile
                          class={
                            staged() && !localOnStage()
                              ? 'w-full h-auto max-h-full aspect-video min-h-0 self-center'
                              : 'size-full min-h-0'
                          }
                          avatarSize="sm"
                        />
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
                    style={controlsRowStyle()}
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
                          <CallMoreMenu.Root
                            compact={compactControls()}
                            onOpenChange={setSettingsOpen}
                          >
                            <Show when={reactionAction()}>
                              {(send) => (
                                <CallMoreMenu.Reactions onReaction={send()} />
                              )}
                            </Show>
                            <Dropdown.Group>
                              <CallMoreMenu.Layout
                                layout={layout()}
                                onLayoutChange={(value) => {
                                  const interaction =
                                    beginInteraction('call.layout.change');
                                  try {
                                    setSavedLayout(value);
                                  } finally {
                                    interaction.end();
                                  }
                                }}
                              />
                              <CallMoreMenu.Participants
                                hasScreenShare={hasAnyScreenShare()}
                                hideParticipants={hideParticipants()}
                                onHideParticipantsChange={
                                  changeParticipantVisibility
                                }
                              />
                              <CallMoreMenu.Fullscreen
                                fullscreen={fullscreen.active()}
                                fullscreenAvailable={fullscreen.available()}
                                onFullscreen={() =>
                                  fireAndForget(
                                    fullscreen.toggle(),
                                    'call-fullscreen'
                                  )
                                }
                              />
                            </Dropdown.Group>
                            <Dropdown.Group>
                              <CallMoreMenu.Shortcuts />
                            </Dropdown.Group>
                          </CallMoreMenu.Root>
                        </Show>
                      </CallControls>
                    </div>
                    <div
                      ref={setPanelToggleFrame}
                      class={cn(
                        isMobile() && 'island',
                        'col-start-3 row-start-1 flex justify-center justify-self-end rounded-full mobile:col-start-2',
                        isMobile() && 'p-1.5'
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
              <div
                ref={setSidebarMount}
                data-call-sidebar
                class="h-full py-2"
              />
            </Resize.Panel>
          </Resize.Zone>
          <Show when={panelMounted()}>
            <CallChatPanel
              animateEntrance={entranceReady()}
              id={panelId}
              open={panelOpen()}
              onClose={closePanel}
              activeTab={activeTab()}
              onTabChange={setSelectedTab}
              chatAvailable={canChat()}
              participantCount={participants().length + 1}
              participants={
                <CallParticipantsList localName={props.localName} />
              }
              work={workTab()}
              workDot={callWork.showTabDot()}
              sidebarMount={widePanel() ? sidebarMount() : undefined}
              overlayMount={overlayMount()}
              returnFocus={panelButton}
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
    </CallFullscreenPortal>
  );
}
