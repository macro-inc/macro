import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { guestDisplayName } from '@channel/Call/call-identity';
import { CallDiscussionHistory } from '@channel/Call/chat/CallChatHistory';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { getDisplayName, tryMacroId } from '@core/user';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { Button, Tabs } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type { CallTranscriptTarget } from '../../constants';
import { recordingChatMessages } from '../../core/recording-chat';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallTranscript } from '../CallTranscript';
import { CallRecordingSidePanel } from '../sidepanel/CallRecordingSidePanel';
import {
  getActiveTranscriptSequenceNum,
  getSegmentVideoSeconds,
  sortTranscriptSegments,
} from '../transcript-playback';
import { useCallAgain } from '../use-call-again';
import { CallRecordingChat } from './CallRecordingChat';
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
  transcriptTarget?: CallTranscriptTarget;
  showOverlayHeaderGap?: boolean;
  messageTarget?: string;
  messageTargetRequestKey?: string | number;
  onClearMessageTarget?: () => void;
}) {
  const record = () => props.record;
  const panel = useSidePanel();
  const [contentTab, setContentTab] = createSignal<'summary' | 'transcript'>(
    'summary'
  );
  const columnTabs = () => panel?.isOverlayMode() || !panel?.isOpen();
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const playback = createRecordingPlayback(videoRef);
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const [playerRef, setPlayerRef] = createSignal<HTMLElement>();
  const [playerOffscreen, setPlayerOffscreen] = createSignal(false);
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
      () => props.transcriptTarget,
      (target) => {
        if (!target) return;
        setContentTab('transcript');
        goToTranscriptSegment(target.transcriptId);
      }
    )
  );

  const callTitle = createMemo(
    () => record().customName ?? record().channelName ?? 'Call Recording'
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
      render={(discussion) => (
        <SidePanel.Layout
          headerToggle={false}
          narrowThreshold={960}
          panel={(details) => (
            <CallRecordingSidePanel
              details={details}
              transcript={
                <CallTranscript
                  transcript={record().transcript}
                  channelId={record().channelId}
                  record={record()}
                  timelineStartMs={timelineStartMs()}
                  activeSequenceNum={activeSequenceNum()}
                  videoSeekGeneration={videoSeekGeneration()}
                  onSeekToSeconds={seekToSeconds}
                  messages={recordingChatMessages(discussion.thread())}
                  hideHeader
                />
              }
            />
          )}
        >
          <div class="relative flex-1 min-h-0 overflow-hidden @container/call-column">
            <SidePanel.HeaderActions>
              <HeaderActionGroup label="Actions">
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
              class="h-full min-h-0 overflow-y-auto overscroll-contain scrollbar-hidden"
              ref={setScrollRef}
            >
              <div class="mx-auto max-w-[800px] min-w-0 px-6 @[760px]/call-column:px-10 pt-4 pb-24 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                <div class="flex flex-col gap-7">
                  <CallRecordingTitle record={record()} />
                  <Show when={canJoin()}>
                    <Button
                      variant="success"
                      size="xl"
                      class="mt-6"
                      onClick={callAgain}
                    >
                      <PhoneCallIcon />
                      Join call
                    </Button>
                  </Show>

                  <Show when={record().recordingUrl}>
                    {(url) => (
                      <section ref={setPlayerRef} class="flex flex-col gap-3">
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
                    <div class="sticky top-0 z-10 bg-surface py-2">
                      <Tabs
                        aria-label="Call content"
                        size="sm"
                        options={[
                          { value: 'summary', label: 'Summary' },
                          { value: 'transcript', label: 'Transcript' },
                        ]}
                        value={contentTab()}
                        onChange={setContentTab}
                      />
                    </div>
                  </Show>
                  <Show
                    when={!columnTabs() || contentTab() === 'summary'}
                    fallback={
                      <CallTranscript
                        transcript={record().transcript}
                        channelId={record().channelId}
                        record={record()}
                        timelineStartMs={timelineStartMs()}
                        activeSequenceNum={activeSequenceNum()}
                        videoSeekGeneration={videoSeekGeneration()}
                        onSeekToSeconds={seekToSeconds}
                        messages={recordingChatMessages(discussion.thread())}
                        scrollElement={scrollRef()}
                        hideHeader
                      />
                    }
                  >
                    <CallRecordingSummarySection
                      record={props.record}
                      hideHeading={columnTabs()}
                    />

                    <CallRecordingChat
                      source={discussion}
                      timelineStartMs={timelineStartMs()}
                      onSeek={record().recordingUrl ? seekToSeconds : undefined}
                      targetId={props.messageTarget}
                      requestKey={props.messageTargetRequestKey}
                      onClearTarget={props.onClearMessageTarget}
                    />
                  </Show>
                </div>
              </div>
            </div>
            <CustomScrollbar scrollContainer={scrollRef} />
            <Show when={playerOffscreen() && record().recordingUrl}>
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
      )}
    />
  );
}
