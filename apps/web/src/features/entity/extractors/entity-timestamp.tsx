import type { DateValue } from '@core/util/date';
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
  return (
    <Show
      when={scheduledSendTime()}
      fallback={<>{formatTimestamp(timestamp())}</>}
    >
      {(sendTime) => <ScheduledBadge sendTime={sendTime()} />}
    </Show>
  );
}
