import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallDiscussionHistory } from '@channel/Call/chat/CallChatHistory';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import type { CallTranscriptTarget } from '../../constants';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallTranscript } from '../CallTranscript';
import {
  getActiveTranscriptSequenceNum,
  getSegmentVideoSeconds,
  sortTranscriptSegments,
} from '../transcript-playback';
import { useCallAgain } from '../use-call-again';
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
  const hasTranscripts = createMemo(() => record().transcript.length > 0);
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const playback = createRecordingPlayback(videoRef);
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
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
        goToTranscriptSegment(target.transcriptId);
      }
    )
  );

  const callTitle = createMemo(
    () => record().customName ?? record().channelName ?? 'Call Recording'
  );

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
    <div class="relative flex-1 min-h-0 overflow-hidden">
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
        class="h-full min-h-0 overflow-y-auto scrollbar-hidden"
        ref={setScrollRef}
      >
        <div class="mx-auto max-w-3xl min-w-0 px-6 pt-4 pb-24 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
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
                <section class="flex flex-col gap-3">
                  <div class="overflow-hidden rounded-2xl">
                    <CallRecordingVideo
                      url={url()}
                      playback={playback}
                      posterUrl={record().recordingPreviewUrl ?? undefined}
                      onTimeUpdate={handleTimeUpdate}
                      setVideoRef={setVideoRef}
                    />
                  </div>
                </section>
              )}
            </Show>

            <CallRecordingSummarySection record={props.record} />

            <Show when={hasTranscripts()}>
              <section class="flex flex-col gap-3">
                <h3 class="text-sm font-semibold text-ink">Transcript</h3>
                <div class="flex flex-col max-h-[min(600px,60vh)] overflow-hidden rounded border border-edge-muted/50">
                  <Suspense
                    fallback={
                      <div class="grid min-h-32 place-items-center text-ink-muted">
                        <SpinnerIcon
                          aria-hidden={false}
                          aria-label="Loading transcript"
                          class="size-5 animate-spin"
                        />
                      </div>
                    }
                  >
                    <CallTranscript
                      transcript={record().transcript}
                      channelId={record().channelId}
                      record={record()}
                      timelineStartMs={timelineStartMs()}
                      activeSequenceNum={activeSequenceNum()}
                      videoSeekGeneration={videoSeekGeneration()}
                      onSeekToSeconds={seekToSeconds}
                      hideHeader
                    />
                  </Suspense>
                </div>
              </section>
            </Show>
            <CallDiscussionHistory
              discussion={record().discussion}
              callId={props.callId}
              targetId={props.messageTarget}
              targetRequestKey={props.messageTargetRequestKey}
              onClearTarget={props.onClearMessageTarget}
            />
          </div>
        </div>
      </div>
      <CustomScrollbar scrollContainer={scrollRef} />
    </div>
  );
}
