import { t } from '@app/lib/i18n';
import { guestDisplayName, isCallGuestId } from '@channel/Call/call-identity';
import { Message } from '@channel/Message';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { MessageData } from '@core/messages/types';
import { formatVideoTimestamp } from '@core/util/duration';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CrosshairIcon from '@icon/system/regular/crosshair.svg';
import WaveformIcon from '@icon/system/regular/waveform.svg';
import { senderFromStorageId } from '@queries/messages/message-sender';
import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { Avatar, Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { messageVideoSeconds } from '../core/recording-chat';
import { getSegmentVideoSeconds } from './transcript-playback';

type TimelineRow =
  | {
      kind: 'transcript';
      key: string;
      seconds: number | null;
      segment: CallRecordTranscriptSegment;
    }
  | { kind: 'chat'; key: string; seconds: number; message: MessageData };

export function CallTranscript(props: {
  transcript: CallRecordTranscriptSegment[];
  channelId?: string | null;
  record?: { guests: Array<{ id: string; displayName: string }> };
  timelineStartMs: number | null;
  durationSeconds?: number;
  activeSequenceNum?: number | null;
  videoSeekGeneration?: number;
  onSeekToSeconds?: (seconds: number) => void;
  hideHeader?: boolean;
  messages?: MessageData[];
  /** Column transcripts share the page scroller; docked transcripts own one. */
  scrollElement?: HTMLElement;
  /** Changes only when the enclosing page's custom scrollbar is dragged. */
  manualScrollGeneration?: number;
  /** Place resynchronization immediately above the host's playback bar. */
  syncTarget?: HTMLElement;
  syncSurface?: 'surface' | 'inset';
}) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const viewport = () => props.scrollElement ?? scrollRef();
  const [following, setFollowing] = createSignal(true);
  const [activeVisible, setActiveVisible] = createSignal(true);
  const rows = new Map<number, HTMLDivElement>();
  let ignoreScrollUntil = 0;

  const timeline = createMemo<TimelineRow[]>(() => {
    const segments: TimelineRow[] = [...props.transcript]
      .sort((a, b) => a.sequenceNum - b.sequenceNum)
      .map((segment) => ({
        kind: 'transcript',
        key: segment.transcriptId,
        segment,
        seconds: getSegmentVideoSeconds(segment, props.timelineStartMs),
      }));
    const messages: TimelineRow[] = (props.messages ?? []).flatMap(
      (message) => {
        const seconds = messageVideoSeconds(
          message.created_at,
          props.timelineStartMs,
          props.durationSeconds
        );
        return seconds === null
          ? []
          : [{ kind: 'chat' as const, key: message.id, seconds, message }];
      }
    );
    return [...segments, ...messages].sort(
      (a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity)
    );
  });

  const updateVisibility = () => {
    const sequence = props.activeSequenceNum;
    if (sequence === null || sequence === undefined) {
      setActiveVisible(true);
      return;
    }
    const container = viewport();
    const row = rows.get(sequence);
    if (!container || !row) {
      setActiveVisible(false);
      return;
    }
    const outer = container.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    setActiveVisible(inner.bottom > outer.top && inner.top < outer.bottom);
  };

  const scrollActiveIntoView = (
    force = false,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    const sequence = props.activeSequenceNum;
    if (sequence === null || sequence === undefined) return;
    const container = viewport();
    const row = rows.get(sequence);
    if (!container || !row) return;
    const outer = container.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    if (!force && inner.top >= outer.top && inner.bottom <= outer.bottom)
      return;
    ignoreScrollUntil = performance.now() + 350;
    container.scrollTo({
      top: Math.max(
        0,
        container.scrollTop +
          inner.top -
          outer.top -
          container.clientHeight / 2 +
          row.clientHeight / 2
      ),
      behavior,
    });
  };

  createEffect(
    on(
      () => props.videoSeekGeneration ?? 0,
      (generation, previous) => {
        if (previous !== undefined && generation !== previous) {
          setFollowing(true);
          scrollActiveIntoView(true);
        }
        updateVisibility();
      }
    )
  );

  createEffect(
    on(
      () => [props.activeSequenceNum, following(), viewport()] as const,
      () => {
        if (following()) scrollActiveIntoView();
        updateVisibility();
      }
    )
  );

  createEffect(
    on(
      () => props.manualScrollGeneration ?? 0,
      (generation, previous) => {
        if (previous !== undefined && generation !== previous)
          setFollowing(false);
      }
    )
  );

  createEffect(() => {
    const element = viewport();
    if (!element) return;
    const stopFollowing = () => setFollowing(false);
    const onScroll = () => {
      if (performance.now() >= ignoreScrollUntil) updateVisibility();
    };
    const onPointerDown = (event: PointerEvent) => {
      // Scrollbar presses target the viewport; content presses target a row.
      if (event.target === element && event.pointerType !== 'touch')
        stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key)
      )
        stopFollowing();
    };
    element.addEventListener('wheel', stopFollowing, { passive: true });
    element.addEventListener('touchmove', stopFollowing, { passive: true });
    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('keydown', onKeyDown);
    const observer = new ResizeObserver(() => {
      if (following()) scrollActiveIntoView(false, 'auto');
      updateVisibility();
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      element.removeEventListener('wheel', stopFollowing);
      element.removeEventListener('touchmove', stopFollowing);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('keydown', onKeyDown);
    });
  });

  const syncButton = () => (
    <div
      class="pointer-events-auto rounded-full border border-edge-muted shadow-menu"
      classList={{
        'bg-inset': props.syncSurface === 'inset',
        'bg-surface': props.syncSurface !== 'inset',
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setFollowing(true);
          scrollActiveIntoView(true);
        }}
      >
        <CrosshairIcon class="size-4" />
        {t('calls.detailSyncToVideo')}
      </Button>
    </div>
  );
  return (
    <div
      class="relative flex min-h-0 flex-col"
      classList={{ 'h-full overflow-hidden': !props.scrollElement }}
    >
      <div
        ref={setScrollRef}
        classList={{
          'h-full min-h-0 flex-1 overflow-y-auto scrollbar-hidden':
            !props.scrollElement,
        }}
      >
        <Show when={!props.hideHeader}>
          <h3 class="px-4 py-3 text-sm font-semibold">
            {t('calls.detailTranscript')}
          </h3>
        </Show>
        <StaticMarkdownContext>
          <div class="flex flex-col gap-1 px-3 pb-6">
            <For each={timeline()}>
              {(item) => {
                if (item.kind === 'chat') {
                  return (
                    <Message.Root
                      message={item.message}
                      class="rounded-xl px-3 py-3"
                    >
                      <div class="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-1">
                        <div class="row-span-3">
                          <Message.SenderIcon />
                        </div>
                        <div class="flex flex-wrap items-center gap-2 text-xs">
                          <Message.SenderName />
                          <span class="flex items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-ink-muted">
                            <ChatIcon class="size-3" />
                            {t('calls.detailChat')}
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              props.onSeekToSeconds?.(item.seconds)
                            }
                          >
                            {formatVideoTimestamp(item.seconds)}
                          </Button>
                        </div>
                        <Message.Content />
                        <Message.Attachments />
                      </div>
                    </Message.Root>
                  );
                }
                const segment = () => item.segment;
                const active = () =>
                  segment().sequenceNum === props.activeSequenceNum;
                const guest = () =>
                  isCallGuestId(props.record, segment().speakerId);
                const name = () =>
                  guestDisplayName(props.record, segment().speakerId) ||
                  t('calls.detailGuest');
                const message = (): MessageData => ({
                  id: item.key,
                  content: segment().content,
                  sender: senderFromStorageId(segment().speakerId),
                  sender_id: segment().speakerId,
                  created_at: segment().startedAt,
                  updated_at: segment().startedAt,
                  attachments: [],
                  reactions: [],
                });
                return (
                  <div
                    data-call-transcript-row
                    ref={(element) => {
                      rows.set(segment().sequenceNum, element);
                      onCleanup(() => rows.delete(segment().sequenceNum));
                    }}
                  >
                    <Message.Root
                      message={message()}
                      class="rounded-xl"
                      classList={{ 'bg-hover': active() }}
                    >
                      <button
                        type="button"
                        class="grid w-full grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl px-3 py-3 text-left"
                        onClick={() => {
                          if (item.seconds !== null)
                            props.onSeekToSeconds?.(item.seconds);
                        }}
                      >
                        <span class="row-span-2">
                          <Show
                            when={!guest()}
                            fallback={
                              <Avatar size="sm">
                                <Avatar.Fallback>
                                  {name().charAt(0)}
                                </Avatar.Fallback>
                              </Avatar>
                            }
                          >
                            <Message.SenderIcon />
                          </Show>
                        </span>
                        <span class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                          <Show
                            when={!guest()}
                            fallback={<span class="font-medium">{name()}</span>}
                          >
                            <Message.SenderName />
                          </Show>
                          <Show when={item.seconds !== null}>
                            <span class="tabular-nums text-ink-muted">
                              {formatVideoTimestamp(item.seconds ?? 0)}
                            </span>
                          </Show>
                          <Show when={active()}>
                            <WaveformIcon class="size-3 text-accent" />
                          </Show>
                        </span>
                        <span class="whitespace-pre-wrap wrap-break-word text-sm leading-5 text-ink-muted">
                          {segment().content}
                        </span>
                      </button>
                    </Message.Root>
                  </div>
                );
              }}
            </For>
          </div>
        </StaticMarkdownContext>
      </div>
      <Show when={!props.scrollElement}>
        <CustomScrollbar
          scrollContainer={scrollRef}
          onScrollIntent={() => setFollowing(false)}
        />
      </Show>
      <Show
        when={
          !following() && !activeVisible() && props.activeSequenceNum != null
        }
      >
        <Show
          when={props.syncTarget}
          fallback={
            <div
              class="pointer-events-none inset-x-0 bottom-4 z-20 flex justify-center py-2"
              classList={{
                absolute: !props.scrollElement,
                sticky: !!props.scrollElement,
              }}
            >
              {syncButton()}
            </div>
          }
        >
          {(target) => (
            <Portal mount={target()}>
              <div class="flex justify-center">{syncButton()}</div>
            </Portal>
          )}
        </Show>
      </Show>
    </div>
  );
}
