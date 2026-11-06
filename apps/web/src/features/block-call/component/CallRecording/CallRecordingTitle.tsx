import { isMobile } from '@core/mobile/isMobile';
import HashIcon from '@icon/system/regular/hash.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { format, isSameDay } from 'date-fns';
import { Show } from 'solid-js';
import { useCallAgain } from '../use-call-again';
import { CallRecordingAvatars } from './CallRecordingParticipants';

export function CallRecordingTitle(props: { record: CallRecord }) {
  const { canCallAgain, callAgain } = useCallAgain(
    () => props.record.callId,
    () => props.record.channelId
  );
  const dateRange = () => {
    const start = new Date(props.record.startedAt);
    const end = props.record.endedAt
      ? new Date(props.record.endedAt)
      : undefined;
    if (!Number.isFinite(start.getTime())) return '';
    const from = format(start, 'EEE, MMM d, h:mm a');
    if (!end || !Number.isFinite(end.getTime())) return from;
    return `${from} – ${format(end, isSameDay(start, end) ? 'h:mm a' : 'EEE, MMM d, h:mm a')}`;
  };

  return (
    <header class="flex min-w-0 flex-col gap-1 @container/call-title">
      <Show when={props.record.channelName}>
        {(channel) => (
          <div class="flex min-w-0 items-center gap-1 text-sm text-ink-muted">
            <HashIcon class="size-4 shrink-0" />
            <span class="truncate">{channel()}</span>
          </div>
        )}
      </Show>
      <h1 class="text-2xl font-semibold tracking-tight text-ink text-balance">
        {props.record.customName ??
          props.record.channelName ??
          'Call Recording'}
      </h1>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
        <span class="mr-auto">{dateRange()}</span>
        <CallRecordingAvatars record={props.record} />
        <Show when={!isMobile() && !props.record.isActive && canCallAgain()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={callAgain}
            tooltip="Call again"
            aria-label="Call again"
          >
            <PhoneCallIcon class="size-4" />
            <span class="@max-[440px]/call-title:hidden">Call again</span>
          </Button>
        </Show>
      </div>
    </header>
  );
}
