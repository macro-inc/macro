import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { beginInteraction, usePending } from '@app/observability/flow';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { guestDisplayName } from '@channel/Call/call-identity';
import { CallDiscussionHistory } from '@channel/Call/chat/CallChatHistory';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import { createScrollIntentTracker } from '@core/util/scroll-intent';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { Button, Tabs } from '@ui';
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
import { recordingChatMessages } from '../../core/recording-chat';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallTranscript } from '../CallTranscript';
import {
  CallDetailsSheetHeader,
  CallRecordingSidePanel,
} from '../sidepanel/CallRecordingSidePanel';
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
  const [contentTab, setContentTab] = createSignal<
    'summary' | 'transcript' | 'chat'
  >('summary');
  const columnTabs = () =>
    isMobile() || panel?.isOverlayMode() || !panel?.isOpen();
  const selectedTab = () =>
    !isMobile() && contentTab() === 'chat' ? 'summary' : contentTab();
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const playback = createRecordingPlayback(videoRef);
  const recordingDuration = () => playback.duration() || undefined;
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const [scrollingDown, setScrollingDown] = createSignal(false);
  const [manualScrollGeneration, setManualScrollGeneration] = createSignal(0);
  const scrollIntent = createScrollIntentTracker(() => {
    const direction = scrollIntent.lastDirection();
    if (direction) setScrollingDown(direction === 'down');
  });
  const [playerRef, setPlayerRef] = createSignal<HTMLElement>();
  const [playerOffscreen, setPlayerOffscreen] = createSignal(false);
  const floatingPlayback = () => playerOffscreen() && !!record().recordingUrl;
  const mobilePlaybackActive = () =>
    selectedTab() === 'transcript' && floatingPlayback() && !panel?.isOpen();
  const headerToggle = () =>
    props.headerToggle && (!panel?.isOpen() || panel?.isOverlayMode());
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
            <Show when={panel?.isOverlayMode()}>{props.header?.()}</Show>
            <div class="relative min-h-0 flex-1">
              <SidePanel.Layout
                headerToggle={headerToggle()}
                narrowThreshold={960}
                drawerHeader={<CallDetailsSheetHeader />}
                panel={(details) => (
                  <CallRecordingSidePanel
                    details={details}
                    footer={
                      <Show
                        when={panel?.isOverlayMode() && record().recordingUrl}
                      >
                        <CallRecordingPinnedPlayer
                          playback={playback}
                          speaker={currentSpeaker()}
                          onShowVideo={() => {
                            panel?.setIsOpen(false);
                            playerRef()?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }}
                        />
                      </Show>
                    }
                    transcript={
                      <CallTranscript
                        transcript={record().transcript}
                        channelId={record().channelId}
                        record={record()}
                        timelineStartMs={timelineStartMs()}
                        durationSeconds={recordingDuration()}
                        activeSequenceNum={activeSequenceNum()}
                        videoSeekGeneration={videoSeekGeneration()}
                        onSeekToSeconds={seekToSeconds}
                        messages={messages()}
                        hideHeader
                      />
                    }
                  />
                )}
              >
                <div class="relative flex h-full min-h-0 flex-col overflow-hidden @container/call-column">
                  <Show when={!panel?.isOverlayMode()}>{props.header?.()}</Show>
                  <SidePanel.HeaderActions>
                    <HeaderActionGroup label={t('calls.detailActions')}>
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
                    class="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hidden"
                    ref={setScrollRef}
                  >
                    <div class="mx-auto max-w-[800px] min-w-0 px-6 mobile:px-5 @[760px]/call-column:px-10 pt-4 pb-24 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                      <div class="flex flex-col gap-7">
                        <div class="mobile:order-2">
                          <CallRecordingTitle record={record()} />
                        </div>
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

                        <Show when={record().recordingUrl}>
                          {(url) => (
                            <section
                              ref={setPlayerRef}
                              class="flex flex-col gap-3 mobile:order-1"
                            >
                              <div class="overflow-hidden rounded-2xl">
                                <CallRecordingVideo
                                  url={url()}
                                  playback={playback}
                                  posterUrl={
                                    record().recordingPreviewUrl ?? undefined
                                  }
                                  onTimeUpdate={handleTimeUpdate}
                                  setVideoRef={setVideoRef}
                                />
                              </div>
                            </section>
                          )}
                        </Show>

                        <Show when={columnTabs()}>
                          <div class="sticky top-0 z-10 bg-surface py-2 mobile:order-3">
                            <Tabs
                              aria-label={t('calls.detailContent')}
                              size={isMobile() ? 'md' : 'sm'}
                              fullWidth={isMobile()}
                              touch="inset"
                              options={[
                                {
                                  value: 'summary',
                                  label: t('calls.detailSummary'),
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
                        </Show>
                        <div class="flex min-w-0 flex-col gap-7 mobile:order-4">
                          <Switch>
                            <Match
                              when={
                                !columnTabs() || selectedTab() === 'summary'
                              }
                            >
                              <CallRecordingSummarySection
                                record={props.record}
                                hideHeading={columnTabs()}
                              />
                              <Show when={!isMobile()}>
                                <CallRecordingChat
                                  source={discussion}
                                  timelineStartMs={timelineStartMs()}
                                  durationSeconds={recordingDuration()}
                                  onSeek={seekRecording()}
                                  targetId={props.messageTarget}
                                  requestKey={props.messageTargetRequestKey}
                                  onClearTarget={props.onClearMessageTarget}
                                />
                              </Show>
                            </Match>
                            <Match when={selectedTab() === 'transcript'}>
                              <CallTranscript
                                transcript={record().transcript}
                                channelId={record().channelId}
                                record={record()}
                                timelineStartMs={timelineStartMs()}
                                durationSeconds={recordingDuration()}
                                activeSequenceNum={activeSequenceNum()}
                                videoSeekGeneration={videoSeekGeneration()}
                                onSeekToSeconds={seekToSeconds}
                                messages={messages()}
                                scrollElement={scrollRef()}
                                manualScrollGeneration={manualScrollGeneration()}
                                hideHeader
                              />
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
                  <CustomScrollbar
                    scrollContainer={scrollRef}
                    onScrollIntent={(delta) => {
                      scrollIntent.markUserIntent(delta > 0 ? 'down' : 'up');
                      setManualScrollGeneration((generation) => generation + 1);
                    }}
                  />
                  <Show when={isMobile()}>
                    <CallRecordingMobilePlayback
                      playback={playback}
                      speaker={currentSpeaker()}
                      active={mobilePlaybackActive()}
                      scrollingDown={scrollingDown()}
                      onShowVideo={() =>
                        playerRef()?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }
                    />
                  </Show>
                  <Show when={!isMobile() && floatingPlayback()}>
                    <div class="absolute inset-x-4 bottom-4 z-20">
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
                    </div>
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
