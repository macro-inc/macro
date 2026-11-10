import { t } from '@app/lib/i18n';
import { CallWaveform } from '@channel/Call/CallWaveform';
import { guestDisplayName, isCallGuestId } from '@channel/Call/call-identity';
import { Message } from '@channel/Message';
import { SenderName } from '@channel/Message/SenderName';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { MessageData } from '@core/messages/types';
import { formatVideoTimestamp } from '@core/util/duration';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CrosshairIcon from '@icon/system/regular/crosshair.svg';
import { senderFromStorageId } from '@queries/messages/message-sender';
import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { Avatar, Button, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createTranscriptScroll } from '../primitives/transcript-scroll';
import { createTranscriptTimeline } from '../primitives/transcript-timeline';

export function CallTranscript(props: {
  transcript: CallRecordTranscriptSegment[];
  channelId?: string | null;
  record?: { guests: Array<{ id: string; displayName: string }> };
  timelineStartMs: number | null;
  durationSeconds?: number;
  activeSequenceNum?: number | null;
  playing?: boolean;
  videoSeekGeneration?: number;
  onSeekToSeconds?: (seconds: number) => void;
  active?: boolean;
  hideHeader?: boolean;
  messages?: MessageData[];
  /** Inline transcripts share the page scroller; cards own one. */
  scrollElement?: HTMLElement;
  /** Changes only when the enclosing page's custom scrollbar is dragged. */
  manualScrollGeneration?: number;
  /** Place resynchronization immediately above the host's playback bar. */
  syncTarget?: HTMLElement;
  syncSurface?: 'surface' | 'inset';
}) {
  const scroll = createTranscriptScroll(props);
  const { scrollRef, setScrollRef, following, activeVisible } = scroll;
  const timeline = createTranscriptTimeline(props);

  const syncButton = () => (
    <div
      class="pointer-events-auto rounded-full border border-edge-muted shadow-menu"
      classList={{
        'bg-inset': props.syncSurface === 'inset',
        'bg-surface': props.syncSurface !== 'inset',
      }}
    >
      <Button variant="secondary" size="sm" onClick={scroll.sync}>
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
          <h3 class="px-3 py-3 text-sm font-semibold">
            {t('calls.detailTranscript')}
          </h3>
        </Show>
        <StaticMarkdownContext>
          <div
            class="flex flex-col gap-1 pb-6"
            classList={{ 'px-3': !props.scrollElement }}
          >
            <For each={timeline()}>
              {(item) => {
                if (item.kind === 'chat') {
                  return (
                    <Message.Root
                      message={item.message}
                      class="rounded-xl px-3 py-3"
                    >
                      <div class="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4 gap-y-0.5">
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
                    ref={(element) =>
                      scroll.registerRow(segment().sequenceNum, element)
                    }
                  >
                    <Message.Root
                      message={message()}
                      class="rounded-xl"
                      classList={{ 'bg-hover': active() }}
                    >
                      <Tooltip.Root>
                        <Tooltip.Trigger
                          as="button"
                          type="button"
                          class="grid w-full grid-cols-[24px_minmax(0,1fr)] gap-x-4 gap-y-0.5 rounded-xl px-3 py-3 text-left"
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
                          <span class="flex min-w-0 items-center justify-between gap-2 text-xs">
                            <span class="min-w-0 flex-1 truncate text-sm font-medium">
                              <Show
                                when={guest()}
                                fallback={<SenderName message={message()} />}
                              >
                                {name()}
                              </Show>
                            </span>
                            <span class="flex shrink-0 items-center justify-end gap-2">
                              <Show when={active()}>
                                <CallWaveform
                                  class="size-3 shrink-0"
                                  live
                                  speaking={props.playing ?? false}
                                />
                              </Show>
                              <Show when={item.seconds !== null}>
                                <span class="tabular-nums text-ink-muted">
                                  {formatVideoTimestamp(item.seconds ?? 0)}
                                </span>
                              </Show>
                            </span>
                          </span>
                          <span class="whitespace-pre-wrap wrap-break-word text-sm leading-5 text-ink-muted">
                            {segment().content}
                          </span>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Content>
                            <Show
                              when={guest()}
                              fallback={<SenderName message={message()} />}
                            >
                              {name()}
                            </Show>
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      </Tooltip.Root>
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
          onScrollIntent={scroll.stopFollowing}
        />
      </Show>
      <Show
        when={
          props.active !== false &&
          !following() &&
          !activeVisible() &&
          props.activeSequenceNum != null
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
