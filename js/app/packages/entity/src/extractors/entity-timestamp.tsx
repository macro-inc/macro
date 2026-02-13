import type { DateValue } from '@core/util/date';
import type { EntityData } from '../types/entity';
import { formatTimestamp } from '../utils/timestamp';

export function EntityTimestamp(props: {
  entity: EntityData;
  overrideTimeStamp?: DateValue;
}) {
  const timestamp = () => {
    if (props.overrideTimeStamp) return props.overrideTimeStamp;
    if (props.entity.updatedAt) return props.entity.updatedAt;
    return new Date();
  };
  return <>{formatTimestamp(timestamp())}</>;
}
