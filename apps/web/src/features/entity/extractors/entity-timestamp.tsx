import type { DateValue } from '@core/util/date';
import PaperclipIcon from '@phosphor/paperclip.svg';
import { Show } from 'solid-js';
import { ScheduledBadge } from '../components/Badges';
import { type EntityData, isEmailEntity } from '../types/entity';
import { formatTimestamp } from '../utils/timestamp';

export function EntityTimestamp(props: {
  entity: EntityData;
  overrideTimeStamp?: DateValue;
}) {
  const timestamp = () => {
    if (props.overrideTimeStamp) return props.overrideTimeStamp;
    if (props.entity.sortTs) return props.entity.sortTs;
    if (props.entity.updatedAt) return props.entity.updatedAt;
    return new Date();
  };
  // A scheduled row's time is when it sends, in every list layout.
  const scheduledSendTime = () =>
    !props.overrideTimeStamp && isEmailEntity(props.entity)
      ? props.entity.scheduledSendTime
      : undefined;
  const hasFileAttachment = () =>
    isEmailEntity(props.entity) && props.entity.hasFileAttachment === true;
  const stamp = () => (
    <Show when={scheduledSendTime()} fallback={formatTimestamp(timestamp())}>
      {(sendTime) => <ScheduledBadge sendTime={sendTime()} />}
    </Show>
  );
  return (
    <Show when={hasFileAttachment()} fallback={stamp()}>
      <span class="flex items-center gap-1 whitespace-nowrap">
        <PaperclipIcon
          class="size-3.5 shrink-0"
          role="img"
          aria-label="Has attachments"
        />
        {stamp()}
      </span>
    </Show>
  );
}
