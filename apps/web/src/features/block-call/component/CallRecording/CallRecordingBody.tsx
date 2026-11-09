import './recording-layout.css';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { beginInteraction, usePending } from '@app/observability/flow';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { guestDisplayName } from '@channel/Call/call-identity';
import { CallDiscussionHistory } from '@channel/Call/chat/CallChatHistory';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import { createScrollIntentTracker } from '@core/util/scroll-intent';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { CallRecord } from '@service-call/client';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, Layer, Tabs } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import type { CallTranscriptTarget } from '../../constants';
import { useRecordingView } from '../../context/recording-view';
import { recordingChatMessages } from '../../core/recording-chat';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallTranscript } from '../CallTranscript';
import {
  getActiveTranscriptSequenceNum,
  getSegmentVideoSeconds,
  sortTranscriptSegments,
} from '../transcript-playback';
import { useCallAgain } from '../use-call-again';
import { CallRecordingChat } from './CallRecordingChat';
import { CallRecordingMobileActions } from './CallRecordingMobileActions';
import { CallRecordingMobilePlayback } from './CallRecordingMobilePlayback';
import { CallRecordingPinnedPlayer } from './CallRecordingPinnedPlayer';
import { CallRecordingSummarySection } from './CallRecordingSummary';
import { CallRecordingTitle } from './CallRecordingTitle';
import { CallRecordingVideo } from './CallRecordingVideo';
import {
  seekDedupeKey,
  shouldCoalesceSeekGenerationBump,
} from './call-recording-utils';

// 520px player + 480px card + 28px section gap + 80px page insets.
// The 1308px group cap keeps the original 800px content cap (720px + insets).
const TRANSCRIPT_LAYOUT_MIN_PX = 1108;
export function CallRecordingBody(props: {
  record: CallRecord;
  callId: string;
  header?: () => JSX.Element;
  transcriptTarget?: CallTranscriptTarget;
  headerToggle?: boolean;
  messageTarget?: string;
  messageTargetRequestKey?: string | number;
  onClearMessageTarget?: () => void;
}) {
  const record = () => props.record;
  const panel = useSidePanel();
  const { contentTab, setContentTab } = useRecordingView();
  const [columnRef, setColumnRef] = createSignal<HTMLDivElement>();
  const columnSize = createElementSize(columnRef);
  const wideTranscript = () =>
    !isMobile() && (columnSize.width ?? 0) >= TRANSCRIPT_LAYOUT_MIN_PX;
  const selectedTab = () =>
    !isMobile() && contentTab() === 'chat' ? 'summary' : contentTab();
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const playback = createRecordingPlayback(videoRef, columnRef);
  const [fullscreenTranscript, setFullscreenTranscript] = createSignal(true);
  const transcriptPanel = () => playback.isFullscreen() || wideTranscript();
  createEffect(
    on(playback.isFullscreen, (active) => {
      if (!active) setFullscreenTranscript(true);
    })
  );
  const toggleFullscreenTranscript = () => {
    const interaction = beginInteraction('call.recording.transcript');
    try {
      setFullscreenTranscript((visible) => !visible);
    } finally {
      interaction.end();
    }
  };
  const recordingDuration = () => playback.duration() || undefined;
  const [pageScrollRef, setPageScrollRef] = createSignal<HTMLDivElement>();
  const [leftScrollRef, setLeftScrollRef] = createSignal<HTMLDivElement>();
  const scrollRef = () =>
    transcriptPanel() ? leftScrollRef() : pageScrollRef();
  const [scrollingDown, setScrollingDown] = createSignal(false);
  const [manualScrollGeneration, setManualScrollGeneration] = createSignal(0);
  const [syncTarget, setSyncTarget] = createSignal<HTMLDivElement>();
  const registerSyncTarget = (element: HTMLDivElement) => {
    setSyncTarget(element);
    onCleanup(() => {
      if (syncTarget() === element) setSyncTarget(undefined);
    });
  };
  const scrollIntent = createScrollIntentTracker(() => {
    const direction = scrollIntent.lastDirection();
    if (direction) setScrollingDown(direction === 'down');
  });
  const [playerRef, setPlayerRef] = createSignal<HTMLElement>();
  const [playerOffscreen, setPlayerOffscreen] = createSignal(false);
  const floatingPlayback = () => playerOffscreen() && !!record().recordingUrl;
  const mobilePlaybackActive = () =>
    selectedTab() === 'transcript' && floatingPlayback() && !panel?.isOpen();
  createEffect(
    on([scrollRef, playerRef], ([root, player]) => {
      if (!root || !player) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          setPlayerOffscreen(
            entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)
          );
        },
        { root }
      );
      observer.observe(player);
      onCleanup(() => observer.disconnect());
    })
  );
  const sortedTranscript = createMemo(() =>
    sortTranscriptSegments(record().transcript)
  );
  const [videoSeekGeneration, setVideoSeekGeneration] = createSignal(0);
  let lastVideoSeekBumpKey: string | null = null;
  let lastVideoSeekBumpAtMs = 0;

  const timelineStartMs = createMemo(() => {
    const anchor = record().recordingStartedAt ?? record().startedAt;
    const ms = new Date(anchor).getTime();
    return Number.isFinite(ms) ? ms : null;
  });

  const bumpVideoSeekGeneration = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const key = seekDedupeKey(seconds);
    const now = performance.now();
    if (
      shouldCoalesceSeekGenerationBump(
        key,
        now,
        lastVideoSeekBumpKey,
        lastVideoSeekBumpAtMs
      )
    )
      return;
    lastVideoSeekBumpKey = key;
    lastVideoSeekBumpAtMs = now;
    setVideoSeekGeneration((n) => n + 1);
  };

  const activeSequenceNum = createMemo(() =>
    getActiveTranscriptSequenceNum(
      sortedTranscript(),
      playbackSeconds(),
      timelineStartMs(),
      allowFutureLead()
    )
  );

  const handleTimeUpdate = (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => {
    setPlaybackSeconds(seconds);
    setAllowFutureLead(source === 'playback');
    if (source === 'seeked') bumpVideoSeekGeneration(seconds);
  };

  const seekToSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const video = videoRef();
    const maxTime = Number.isFinite(video?.duration ?? Number.NaN)
      ? (video!.duration as number)
      : seconds;
    const targetSeconds = Math.max(0, Math.min(seconds, maxTime));

    setPlaybackSeconds(targetSeconds);
    setAllowFutureLead(false);
    bumpVideoSeekGeneration(targetSeconds);

    if (video) video.currentTime = targetSeconds;
  };

  const goToTranscriptSegment = (transcriptId: string) => {
    const segment = sortedTranscript().find(
      (s) => s.transcriptId === transcriptId
    );
    if (!segment) return;
    const seconds = getSegmentVideoSeconds(segment, timelineStartMs());
    if (seconds === null) return;
    seekToSeconds(seconds);
  };

  createEffect(
    on(
      () =>
        [
          props.transcriptTarget,
          props.messageTarget,
          props.messageTargetRequestKey,
        ] as const,
      ([target, messageTarget]) => {
        if (messageTarget) {
          setContentTab(isMobile() ? 'chat' : 'summary');
          return;
        }
        if (!target) return;
        setContentTab('transcript');
        goToTranscriptSegment(target.transcriptId);
      }
    )
  );

  const callTitle = createMemo(
    () =>
      record().customName ??
      record().channelName ??
      t('calls.detailFallbackName')
  );
  const currentSpeaker = () => {
    const segment = sortedTranscript().find(
      (item) => item.sequenceNum === activeSequenceNum()
    );
    if (!segment) return callTitle();
    return (
      guestDisplayName(record(), segment.speakerId) ||
      getDisplayName(tryMacroId(segment.speakerId))
    );
  };

  const callCtx = useCallContextOptional();
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.callId,
    () => record().channelId
  );
  const canJoin = () =>
    record().isActive &&
    canCallAgain() &&
    callCtx?.activeCallId() !== props.callId;

  return (
    <CallDiscussionHistory
      discussion={record().discussion}
      callId={props.callId}
      render={(discussion) => {
        usePending('call.discussion', discussion.loading);
        const messages = createMemo(() =>
          recordingChatMessages(discussion.thread())
        );
        const seekRecording = () =>
          record().recordingUrl ? seekToSeconds : undefined;
        return (
          <div class="flex size-full min-h-0 min-w-0 flex-col">
            {props.header?.()}
            <div class="relative min-h-0 flex-1">
              <SidePanel.Layout
                headerToggle={props.headerToggle ?? false}
                floating
              >
                <div
                  ref={setColumnRef}
                  class="recording-workspace relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden @container/call-column"
                  data-fullscreen-transcript={fullscreenTranscript()}
                >
                  <SidePanel.HeaderActions>
                    <HeaderActionGroup label={t('calls.detailActions')}>
                      <Show
                        when={
                          !isMobile() && !record().isActive && canCallAgain()
                        }
                      >
                        <HeaderActionButton
                          grouped
                          onClick={callAgain}
                          label={t('calls.detailCallAgain')}
                          tooltip={t('calls.detailCallAgain')}
                          icon={<PhoneCallIcon class="size-4" />}
                        />
                      </Show>
                      <AskMacroButton
                        grouped
                        entity={{
                          type: 'document',
                          id: props.callId,
                          name: callTitle(),
                          fileType: 'call',
                        }}
                      />
                    </HeaderActionGroup>
                  </SidePanel.HeaderActions>
                  <div
                    data-channel-scroll
                    {...scrollIntent.handlers}
                    onScroll={() => scrollIntent.observeScroll()}
                    class="recording-page-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hidden @[1108px]/call-column:overflow-hidden"
                    ref={setPageScrollRef}
                  >
                    <div class="recording-content mx-auto max-w-[800px] min-w-0 px-6 mobile:px-5 @[760px]/call-column:px-10 pt-4 pb-24 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom) @[1108px]/call-column:h-full @[1108px]/call-column:max-w-[1308px] @[1108px]/call-column:pb-4">
                      <div class="recording-columns flex flex-col gap-7 @[1108px]/call-column:grid @[1108px]/call-column:h-full @[1108px]/call-column:min-h-0 @[1108px]/call-column:grid-cols-[minmax(0,1fr)_480px] @[1108px]/call-column:grid-rows-[auto_minmax(0,1fr)]">
                        <div class="recording-identity flex flex-col gap-7 mobile:order-2 @[1108px]/call-column:col-span-2">
                          <CallRecordingTitle record={record()} />
                          <Show when={canJoin()}>
                            <Button
                              variant="success"
                              size="xl"
                              class="mt-6"
                              onClick={callAgain}
                            >
                              <PhoneCallIcon />
                              {t('calls.detailJoinCall')}
                            </Button>
                          </Show>
                        </div>
                        <div class="recording-player-column contents @[1108px]/call-column:relative @[1108px]/call-column:flex @[1108px]/call-column:min-h-0 @[1108px]/call-column:min-w-0 @[1108px]/call-column:flex-col">
                          <div
                            ref={setLeftScrollRef}
                            data-recording-scroll="content"
                            {...scrollIntent.handlers}
                            onScroll={() => scrollIntent.observeScroll()}
                            class="recording-left-scroll contents @[1108px]/call-column:flex @[1108px]/call-column:min-h-0 @[1108px]/call-column:flex-1 @[1108px]/call-column:flex-col @[1108px]/call-column:gap-7 @[1108px]/call-column:overflow-y-auto @[1108px]/call-column:overscroll-contain @[1108px]/call-column:scrollbar-hidden @[1108px]/call-column:pb-24"
                          >
                            <Show when={record().recordingUrl}>
                              {(url) => (
                                <section
                                  ref={setPlayerRef}
                                  class="flex shrink-0 flex-col gap-3 mobile:order-1"
                                >
                                  <div class="overflow-hidden rounded-2xl">
                                    <CallRecordingVideo
                                      url={url()}
                                      playback={playback}
                                      posterUrl={
                                        record().recordingPreviewUrl ??
                                        undefined
                                      }
                                      onTimeUpdate={handleTimeUpdate}
                                      setVideoRef={setVideoRef}
                                      transcriptControls={
                                        playback.isFullscreen()
                                          ? {
                                              visible: fullscreenTranscript(),
                                              onToggle:
                                                toggleFullscreenTranscript,
                                            }
                                          : undefined
                                      }
                                    />
                                  </div>
                                </section>
                              )}
                            </Show>

                            <div class="recording-reading flex min-w-0 shrink-0 flex-col gap-1 mobile:order-3">
                              <div class="@[1108px]/call-column:hidden">
                                <Tabs
                                  aria-label={t('calls.detailContent')}
                                  size="md"
                                  fullWidth={isMobile()}
                                  options={[
                                    {
                                      value: 'summary',
                                      label: t('calls.detailSummary'),
                                      icon: SparkleIcon,
                                      tooltip: t('calls.detailAttribution'),
                                    },
                                    {
                                      value: 'transcript',
                                      label: t('calls.detailTranscript'),
                                    },
                                    ...(isMobile()
                                      ? [
                                          {
                                            value: 'chat' as const,
                                            label: t('calls.detailChat'),
                                            count: messages().length,
                                          },
                                        ]
                                      : []),
                                  ]}
                                  value={selectedTab()}
                                  onChange={(tab) => {
                                    const interaction = beginInteraction(
                                      'call.detail.tab',
                                      {
                                        attributes: {
                                          'call.id': props.callId,
                                          'call.tab': tab,
                                        },
                                      }
                                    );
                                    try {
                                      setContentTab(tab);
                                    } finally {
                                      interaction.end();
                                    }
                                  }}
                                />
                              </div>
                              <div class="flex min-w-0 flex-col gap-7">
                                <Switch>
                                  <Match
                                    when={
                                      wideTranscript() ||
                                      selectedTab() === 'summary'
                                    }
                                  >
                                    <CallRecordingSummarySection
                                      record={props.record}
                                      hideHeading={!wideTranscript()}
                                    />
                                    <Show when={!isMobile()}>
                                      <CallRecordingChat
                                        source={discussion}
                                        timelineStartMs={timelineStartMs()}
                                        durationSeconds={recordingDuration()}
                                        onSeek={seekRecording()}
                                        targetId={props.messageTarget}
                                        requestKey={
                                          props.messageTargetRequestKey
                                        }
                                        onClearTarget={
                                          props.onClearMessageTarget
                                        }
                                      />
                                    </Show>
                                  </Match>
                                  <Match when={selectedTab() === 'chat'}>
                                    <CallRecordingChat
                                      source={discussion}
                                      timelineStartMs={timelineStartMs()}
                                      durationSeconds={recordingDuration()}
                                      onSeek={seekRecording()}
                                      targetId={props.messageTarget}
                                      requestKey={props.messageTargetRequestKey}
                                      onClearTarget={props.onClearMessageTarget}
                                      hideHeading
                                    />
                                  </Match>
                                </Switch>
                              </div>
                            </div>
                          </div>
                          <CustomScrollbar
                            scrollContainer={scrollRef}
                            onScrollIntent={(delta) => {
                              scrollIntent.markUserIntent(
                                delta > 0 ? 'down' : 'up'
                              );
                              setManualScrollGeneration(
                                (generation) => generation + 1
                              );
                            }}
                          />
                          <Show when={!isMobile()}>
                            <div class="recording-docks pointer-events-none absolute inset-x-0 bottom-4 z-20 mx-auto w-full max-w-[800px] px-4 @[640px]/call-column:px-6 @[760px]/call-column:px-10 @[1108px]/call-column:px-0">
                              <div
                                ref={registerSyncTarget}
                                class="mb-3 empty:hidden"
                              />
                              <Show when={floatingPlayback()}>
                                <CallRecordingPinnedPlayer
                                  playback={playback}
                                  speaker={currentSpeaker()}
                                  onShowVideo={() =>
                                    playerRef()?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start',
                                    })
                                  }
                                />
                              </Show>
                            </div>
                          </Show>
                        </div>
                        <Layer offset={transcriptPanel() ? 1 : 0}>
                          <aside
                            aria-label={t('calls.detailTranscript')}
                            class="recording-transcript-card min-w-0 -mt-6 mobile:order-3 @[1108px]/call-column:sticky @[1108px]/call-column:top-0 @[1108px]/call-column:mt-0 @[1108px]/call-column:flex @[1108px]/call-column:min-h-0 @[1108px]/call-column:flex-col @[1108px]/call-column:overflow-hidden @[1108px]/call-column:rounded-2xl @[1108px]/call-column:bg-surface @[1108px]/call-column:light-mode:ring-1 @[1108px]/call-column:light-mode:ring-inset @[1108px]/call-column:light-mode:ring-edge-frame @[1108px]/call-column:light-mode:shadow-md"
                            inert={
                              playback.isFullscreen() && !fullscreenTranscript()
                            }
                            classList={{
                              hidden:
                                !transcriptPanel() &&
                                selectedTab() !== 'transcript',
                            }}
                          >
                            <CallTranscript
                              transcript={record().transcript}
                              channelId={record().channelId}
                              record={record()}
                              timelineStartMs={timelineStartMs()}
                              durationSeconds={recordingDuration()}
                              activeSequenceNum={activeSequenceNum()}
                              playing={!playback.paused()}
                              videoSeekGeneration={videoSeekGeneration()}
                              onSeekToSeconds={seekToSeconds}
                              messages={messages()}
                              active={
                                playback.isFullscreen()
                                  ? fullscreenTranscript()
                                  : wideTranscript() ||
                                    selectedTab() === 'transcript'
                              }
                              scrollElement={
                                transcriptPanel() ? undefined : scrollRef()
                              }
                              manualScrollGeneration={
                                transcriptPanel()
                                  ? undefined
                                  : manualScrollGeneration()
                              }
                              syncTarget={
                                transcriptPanel() ? undefined : syncTarget()
                              }
                              hideHeader={!transcriptPanel()}
                              syncSurface={
                                transcriptPanel() ? 'inset' : 'surface'
                              }
                            />
                          </aside>
                        </Layer>
                      </div>
                    </div>
                  </div>
                  <Show when={isMobile()}>
                    <CallRecordingMobileActions
                      callId={props.callId}
                      name={callTitle()}
                      active={
                        selectedTab() !== 'transcript' && !panel?.isOpen()
                      }
                    />
                  </Show>
                  <Show when={isMobile()}>
                    <CallRecordingMobilePlayback
                      playback={playback}
                      speaker={currentSpeaker()}
                      active={mobilePlaybackActive()}
                      scrollingDown={scrollingDown()}
                      syncTargetRef={registerSyncTarget}
                      onShowVideo={() =>
                        playerRef()?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }
                    />
                  </Show>
                </div>
              </SidePanel.Layout>
            </div>
          </div>
        );
      }}
    />
  );
}
