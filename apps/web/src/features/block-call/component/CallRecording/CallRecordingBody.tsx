import './recording-layout.css';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallDiscussionHistory } from '@channel/Call/chat/CallChatHistory';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { isMobile } from '@core/mobile/isMobile';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { CallRecord } from '@service-call/client';
import { Button, Layer, Tabs } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { CallTranscriptTarget } from '../../constants';
import { recordingChatMessages } from '../../core/recording-chat';
import { createRecordingIdentity } from '../../primitives/recording-identity';
import { createRecordingLayout } from '../../primitives/recording-layout';
import { createRecordingNavigation } from '../../primitives/recording-navigation';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { createRecordingTimeline } from '../../primitives/recording-timeline';
import { createTranscriptFollow } from '../../primitives/transcript-scroll';
import { CallTranscript } from '../CallTranscript';
import { useCallAgain } from '../use-call-again';
import { CallRecordingChat } from './CallRecordingChat';
import { CallRecordingMobileActions } from './CallRecordingMobileActions';
import { CallRecordingMobilePlayback } from './CallRecordingMobilePlayback';
import { CallRecordingPinnedPlayer } from './CallRecordingPinnedPlayer';
import { CallRecordingSummarySection } from './CallRecordingSummary';
import { CallRecordingTitle } from './CallRecordingTitle';
import { CallRecordingVideo } from './CallRecordingVideo';

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
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const [columnRef, setColumnRef] = createSignal<HTMLDivElement>();
  const playback = createRecordingPlayback(videoRef, columnRef);
  const layout = createRecordingLayout({
    playback,
    columnRef,
    hasRecording: () => !!record().recordingUrl,
  });
  const {
    wideTranscript,
    transcriptPanel,
    fullscreenTranscript,
    toggleFullscreenTranscript,
    scrollRef,
    scrollIntent,
    scrollingDown,
    floatingPlayback,
    syncTarget,
    registerSyncTarget,
    setPageScrollRef,
    setLeftScrollRef,
    setPlayerColumnRef,
    setPlayerRef,
    setTranscriptCardRef,
  } = layout;
  const transcriptFollow = createTranscriptFollow();
  const recordingDuration = () => playback.duration() || undefined;
  const mobilePlaybackActive = () =>
    selectedTab() === 'transcript' && floatingPlayback() && !panel?.isOpen();
  const {
    timelineStartMs,
    activeSequenceNum,
    handleTimeUpdate,
    seekToSeconds,
    goToTranscriptSegment,
    videoSeekGeneration,
  } = createRecordingTimeline(record, videoRef);
  const { selectedTab, selectTab } = createRecordingNavigation({
    get callId() {
      return props.callId;
    },
    get transcriptTarget() {
      return props.transcriptTarget;
    },
    get messageTarget() {
      return props.messageTarget;
    },
    get messageTargetRequestKey() {
      return props.messageTargetRequestKey;
    },
    goToTranscriptSegment,
  });

  const { title: callTitle, currentSpeaker } = createRecordingIdentity(
    record,
    activeSequenceNum
  );

  const callCtx = useCallContextOptional();
  const { canCallAgain, callAgain, joinCall } = useCallAgain(
    () => props.callId,
    () => record().channelId
  );
  const canJoin = () => {
    if (!record().isActive || !canCallAgain()) return false;
    return callCtx?.activeCallId() !== props.callId;
  };
  const showCallAgain = () => {
    if (isMobile() || record().isActive) return false;
    return canCallAgain();
  };
  const transcriptActive = () => {
    if (playback.isFullscreen()) return fullscreenTranscript();
    return wideTranscript() || selectedTab() === 'transcript';
  };
  const transcriptHidden = () =>
    !transcriptPanel() && selectedTab() !== 'transcript';
  const fullscreenControls = () => {
    if (!playback.isFullscreen()) return undefined;
    return {
      visible: fullscreenTranscript(),
      onToggle: toggleFullscreenTranscript,
    };
  };

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
        const readingTabs = () => {
          const tabs = [
            {
              value: 'summary' as const,
              label: t('calls.detailSummary'),
              icon: SparkleIcon,
              tooltip: t('calls.detailAttribution'),
            },
            {
              value: 'transcript' as const,
              label: t('calls.detailTranscript'),
            },
          ];
          if (!isMobile()) return tabs;
          return [
            ...tabs,
            {
              value: 'chat' as const,
              label: t('calls.detailChat'),
              count: messages().length,
            },
          ];
        };
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
                      <Show when={showCallAgain()}>
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
                              onClick={joinCall}
                            >
                              <PhoneCallIcon />
                              {t('calls.detailJoinCall')}
                            </Button>
                          </Show>
                        </div>
                        <div
                          ref={setPlayerColumnRef}
                          class="recording-player-column contents @[1108px]/call-column:relative @[1108px]/call-column:flex @[1108px]/call-column:min-h-0 @[1108px]/call-column:min-w-0 @[1108px]/call-column:flex-col"
                        >
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
                                      transcriptControls={fullscreenControls()}
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
                                  options={readingTabs()}
                                  value={selectedTab()}
                                  onChange={selectTab}
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
                              if (!transcriptPanel())
                                transcriptFollow.stopFollowing();
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
                                  onShowVideo={layout.showVideo}
                                />
                              </Show>
                            </div>
                          </Show>
                        </div>
                        <Layer offset={transcriptPanel() ? 1 : 0}>
                          <aside
                            ref={setTranscriptCardRef}
                            aria-label={t('calls.detailTranscript')}
                            class="recording-transcript-card min-w-0 -mt-6 mobile:order-3 @[1108px]/call-column:sticky @[1108px]/call-column:top-0 @[1108px]/call-column:mt-0 @[1108px]/call-column:flex @[1108px]/call-column:min-h-0 @[1108px]/call-column:flex-col @[1108px]/call-column:overflow-hidden @[1108px]/call-column:rounded-2xl @[1108px]/call-column:bg-surface @[1108px]/call-column:light-mode:ring-1 @[1108px]/call-column:light-mode:ring-inset @[1108px]/call-column:light-mode:ring-edge-frame @[1108px]/call-column:light-mode:shadow-md"
                            inert={
                              playback.isFullscreen() && !fullscreenTranscript()
                            }
                            classList={{
                              hidden: transcriptHidden(),
                            }}
                          >
                            <CallTranscript.Root
                              transcript={record().transcript}
                              record={record()}
                              timelineStartMs={timelineStartMs()}
                              durationSeconds={recordingDuration()}
                              activeSequenceNum={activeSequenceNum()}
                              playing={!playback.paused()}
                              videoSeekGeneration={videoSeekGeneration()}
                              onSeekToSeconds={seekToSeconds}
                              messages={messages()}
                              active={transcriptActive()}
                              scrollElement={
                                transcriptPanel() ? undefined : scrollRef()
                              }
                              follow={transcriptFollow}
                            >
                              <CallTranscript.ScrollArea>
                                <Show when={transcriptPanel()}>
                                  <CallTranscript.Header />
                                </Show>
                                <CallTranscript.Content />
                              </CallTranscript.ScrollArea>
                              <CallTranscript.Scrollbar />
                              <CallTranscript.Sync
                                mount={
                                  transcriptPanel() ? undefined : syncTarget()
                                }
                                surface={
                                  transcriptPanel() ? 'inset' : 'surface'
                                }
                              />
                            </CallTranscript.Root>
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
                      onShowVideo={layout.showVideo}
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
