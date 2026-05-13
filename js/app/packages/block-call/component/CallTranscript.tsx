import { Message } from '@channel/Message';
import { Thread } from '@channel/Thread/Thread';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { formatVideoTimestamp } from '@core/util/duration';
import Subtitles from '@phosphor-icons/core/assets/regular/subtitles.svg';
import type { ApiChannelMessage } from '@service-comms/client';
import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { getSegmentVideoSeconds } from './transcript-playback';

// Match the channel message grouping window (5 minutes).
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

type SegmentItem = {
  segment: CallRecordTranscriptSegment;
  groupedWithPrevious: boolean;
};

function shouldGroupWithPrevious(
  current: CallRecordTranscriptSegment,
  previous: CallRecordTranscriptSegment | undefined
): boolean {
  if (!previous) return false;
  if (current.speakerId !== previous.speakerId) return false;
  const gap =
    new Date(current.startedAt).getTime() -
    new Date(previous.startedAt).getTime();
  return gap >= 0 && gap <= GROUPING_WINDOW_MS;
}

function segmentToApiChannelMessage(
  s: CallRecordTranscriptSegment,
  channelId: string
): ApiChannelMessage {
  return {
    id: s.segmentId ?? `transcript-${s.sequenceNum}`,
    channel_id: channelId,
    content: s.content,
    sender_id: s.speakerId,
    created_at: s.startedAt,
    updated_at: s.startedAt,
    attachments: [],
    reactions: [],
    thread: { preview: [], reply_count: 0 },
  };
}

function TranscriptSegmentRow(props: {
  segment: CallRecordTranscriptSegment;
  channelId: string;
  isActive: boolean;
  timelineStartMs: number | null;
  onSeekToSeconds?: (seconds: number) => void;
}) {
  const message = segmentToApiChannelMessage(props.segment, props.channelId);
  const videoTimestamp = getSegmentVideoSeconds(
    props.segment,
    props.timelineStartMs
  );
  return (
    <Thread.Row message={message}>
      <Message.Root
        message={message}
        highlighted={props.isActive}
        selected={props.isActive}
        onClick={() => {
          if (videoTimestamp !== null) props.onSeekToSeconds?.(videoTimestamp);
        }}
      >
        <Message.Layout class="pt-(--regular-message-padding-t)">
          <Message.Slot placement="icon">
            <Message.SenderIcon />
          </Message.Slot>
          <Message.Slot
            placement="header"
            class="flex items-center gap-1 min-w-0"
          >
            <Message.SenderName />
            <span class="ml-auto text-xs text-ink-muted tabular-nums">
              <Show
                when={videoTimestamp !== null}
                fallback={<Message.Timestamp />}
              >
                {formatVideoTimestamp(videoTimestamp ?? 0)}
              </Show>
            </span>
          </Message.Slot>
          <Message.Slot placement="content">
            <div class="whitespace-pre-wrap wrap-break-word text-sm">
              {props.segment.content}
            </div>
          </Message.Slot>
        </Message.Layout>
      </Message.Root>
    </Thread.Row>
  );
}

function GroupedTranscriptSegmentRow(props: {
  segment: CallRecordTranscriptSegment;
  channelId: string;
  isActive: boolean;
  timelineStartMs: number | null;
  onSeekToSeconds?: (seconds: number) => void;
}) {
  const message = segmentToApiChannelMessage(props.segment, props.channelId);
  const videoTimestamp = getSegmentVideoSeconds(
    props.segment,
    props.timelineStartMs
  );
  return (
    <Thread.Row message={message}>
      <Message.Root
        message={message}
        highlighted={props.isActive}
        selected={props.isActive}
        onClick={() => {
          if (videoTimestamp !== null) props.onSeekToSeconds?.(videoTimestamp);
        }}
      >
        <Message.Layout>
          <Message.Slot placement="icon">
            <Message.SenderIcon hidden />
          </Message.Slot>
          <Message.Slot placement="content">
            <div class="whitespace-pre-wrap wrap-break-word text-sm">
              {props.segment.content}
            </div>
          </Message.Slot>
        </Message.Layout>
      </Message.Root>
    </Thread.Row>
  );
}

export function CallTranscript(props: {
  transcript: CallRecordTranscriptSegment[];
  channelId: string;
  timelineStartMs: number | null;
  activeSequenceNum?: number | null;
  /** Bumps when the user seeks via the native video controls (deduped in CallBlockAdapter). */
  videoSeekGeneration?: number;
  onSeekToSeconds?: (seconds: number) => void;
  hideHeader?: boolean;
}) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [syncToVideoTime, setSyncToVideoTime] = createSignal(true);
  const [isActiveRowInView, setIsActiveRowInView] = createSignal(true);
  const rowRefs = new Map<number, HTMLDivElement>();
  let ignoreScrollUntil = 0;

  const transcriptMeta = createMemo(() => {
    const sorted = [...props.transcript].sort(
      (a, b) => a.sequenceNum - b.sequenceNum
    );
    const items: SegmentItem[] = sorted.map((segment, index) => ({
      segment,
      groupedWithPrevious: shouldGroupWithPrevious(segment, sorted[index - 1]),
    }));
    return { items };
  });

  const scrollActiveIntoView = (
    behavior: ScrollBehavior = 'smooth',
    opts?: { mode?: 'auto' | 'force' }
  ) => {
    const activeSequenceNum = props.activeSequenceNum;
    if (activeSequenceNum === null || activeSequenceNum === undefined) return;

    const container = scrollRef();
    const row = rowRefs.get(activeSequenceNum);
    if (!container || !row) return;

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const mode = opts?.mode ?? 'auto';

    if (mode === 'auto') {
      const isAbove = rowRect.top < containerRect.top;
      const isBelow = rowRect.bottom > containerRect.bottom;
      if (!isAbove && !isBelow) return;
    }

    const targetScrollTop =
      container.scrollTop +
      (rowRect.top - containerRect.top) -
      container.clientHeight / 2 +
      row.clientHeight / 2;

    ignoreScrollUntil = performance.now() + 350;
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior,
    });
  };

  const updateActiveRowVisibility = () => {
    const activeSequenceNum = props.activeSequenceNum;
    if (activeSequenceNum === null || activeSequenceNum === undefined) {
      setIsActiveRowInView(true);
      return;
    }

    const container = scrollRef();
    const row = rowRefs.get(activeSequenceNum);
    if (!container || !row) {
      setIsActiveRowInView(false);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const intersects =
      rowRect.bottom > containerRect.top && rowRect.top < containerRect.bottom;
    setIsActiveRowInView(intersects);
  };

  const onTranscriptViewportResize = () => {
    updateActiveRowVisibility();

    // If we're following video time, keep the active row placed sensibly after layout changes.
    if (syncToVideoTime()) {
      scrollActiveIntoView('auto');
      updateActiveRowVisibility();
      return;
    }

    // If the user has disabled follow-scroll, don't fight them — unless the active row is now
    // fully scrolled out of view due to a viewport resize, in which case recover visibility.
    if (!isActiveRowInView()) {
      scrollActiveIntoView('auto');
      updateActiveRowVisibility();
    }
  };

  /** Avoid double `scrollActiveIntoView` when seek bumps `videoSeekGeneration` and active line updates in the same flush. */
  let suppressFollowScrollAfterSeek = false;

  createEffect(
    on(
      () => props.videoSeekGeneration ?? 0,
      (gen, prev) => {
        if (prev === undefined) {
          updateActiveRowVisibility();
          return;
        }
        if (gen !== prev) {
          suppressFollowScrollAfterSeek = true;
          queueMicrotask(() => {
            suppressFollowScrollAfterSeek = false;
          });
          setSyncToVideoTime(true);
          scrollActiveIntoView('smooth', { mode: 'force' });
          updateActiveRowVisibility();
        }
      }
    )
  );

  createEffect(() => {
    void props.activeSequenceNum;
    void syncToVideoTime();
    void scrollRef();

    if (suppressFollowScrollAfterSeek) {
      updateActiveRowVisibility();
      return;
    }

    if (syncToVideoTime()) {
      scrollActiveIntoView();
    }
    updateActiveRowVisibility();
  });

  createEffect(() => {
    const el = scrollRef();
    if (!el) return;

    let rafId = 0;
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        onTranscriptViewportResize();
      });
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    });
  });

  return (
    <div class="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div class="relative flex flex-1 min-h-0 flex-col">
        <div
          ref={setScrollRef}
          class="h-full min-h-0 flex-1 overflow-y-auto scrollbar-hidden"
          onWheel={() => setSyncToVideoTime(false)}
          onTouchMove={() => setSyncToVideoTime(false)}
          onScroll={() => {
            if (performance.now() < ignoreScrollUntil) return;
            updateActiveRowVisibility();
          }}
        >
          <Show when={!props.hideHeader}>
            <div class="isolate flex items-center gap-2 sticky top-0 bg-surface z-10 px-4 py-2 @[860px]:py-4 border-b border-edge-muted/50">
              <Subtitles class="size-4 text-ink shrink-0" />
              <p class="font-semibold text-ink select-none text-sm shrink-0">
                Transcript
              </p>
            </div>
          </Show>

          <div class="flex flex-col p-4 pt-0">
            <For each={transcriptMeta().items}>
              {(item) => (
                <Show
                  when={item.groupedWithPrevious}
                  fallback={
                    <div
                      ref={(el) => rowRefs.set(item.segment.sequenceNum, el)}
                    >
                      <TranscriptSegmentRow
                        segment={item.segment}
                        channelId={props.channelId}
                        isActive={
                          item.segment.sequenceNum === props.activeSequenceNum
                        }
                        timelineStartMs={props.timelineStartMs}
                        onSeekToSeconds={props.onSeekToSeconds}
                      />
                    </div>
                  }
                >
                  <div ref={(el) => rowRefs.set(item.segment.sequenceNum, el)}>
                    <GroupedTranscriptSegmentRow
                      segment={item.segment}
                      channelId={props.channelId}
                      isActive={
                        item.segment.sequenceNum === props.activeSequenceNum
                      }
                      timelineStartMs={props.timelineStartMs}
                      onSeekToSeconds={props.onSeekToSeconds}
                    />
                  </div>
                </Show>
              )}
            </For>
          </div>
        </div>
      </div>
      <Show
        when={
          !syncToVideoTime() &&
          !isActiveRowInView() &&
          props.activeSequenceNum !== null &&
          props.activeSequenceNum !== undefined
        }
      >
        <div
          class="absolute bottom-0 inset-x-px px-2 pb-2 flex justify-center pointer-events-none z-20"
          style={{
            'background-image':
              'linear-gradient(transparent, var(--color-surface) 85%)',
          }}
        >
          <button
            type="button"
            class="pointer-events-auto isolate overflow-hidden relative bg-surface border border-accent/30 flex h-8 px-2 items-center justify-center text-xs/5 font-mono uppercase font-medium  whitespace-nowrap text-accent before:absolute before:inset-0 before:bg-accent/10 hover:before:bg-accent/20 before:content-[''] before:transition-colors"
            onClick={() => {
              setSyncToVideoTime(true);
              scrollActiveIntoView('smooth');
              setIsActiveRowInView(true);
            }}
          >
            <span class="relative z-user-highlight">Sync to video time</span>
          </button>
        </div>
      </Show>
      <CustomScrollbar scrollContainer={scrollRef} />
    </div>
  );
}
