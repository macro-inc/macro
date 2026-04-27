import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import type { ApiChannelMessage } from '@service-comms/client';
import { Message } from '@channel/Message';
import { Thread } from '@channel/Thread/Thread';
import { createMemo, For, Show } from 'solid-js';

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
}) {
  const message = createMemo(() =>
    segmentToApiChannelMessage(props.segment, props.channelId)
  );
  return (
    <Thread.Row message={message()}>
      <Message.Root message={message()}>
        <Message.Layout class="pt-(--regular-message-padding-t)">
          <Message.Slot placement="icon">
            <Message.SenderIcon />
          </Message.Slot>
          <Message.Slot
            placement="header"
            class="flex items-center gap-1 min-w-0"
          >
            <Message.SenderName />
            <Message.Timestamp class="ml-auto" />
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
}) {
  const message = createMemo(() =>
    segmentToApiChannelMessage(props.segment, props.channelId)
  );
  return (
    <Thread.Row message={message()}>
      <Message.Root message={message()}>
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
}) {
  const items = createMemo<SegmentItem[]>(() => {
    const sorted = [...props.transcript].sort(
      (a, b) => a.sequenceNum - b.sequenceNum
    );
    return sorted.map((segment, index) => ({
      segment,
      groupedWithPrevious: shouldGroupWithPrevious(segment, sorted[index - 1]),
    }));
  });

  return (
    <div class="flex flex-col py-2">
      <For each={items()}>
        {(item) => (
          <Show
            when={item.groupedWithPrevious}
            fallback={
              <TranscriptSegmentRow
                segment={item.segment}
                channelId={props.channelId}
              />
            }
          >
            <GroupedTranscriptSegmentRow
              segment={item.segment}
              channelId={props.channelId}
            />
          </Show>
        )}
      </For>
    </div>
  );
}
