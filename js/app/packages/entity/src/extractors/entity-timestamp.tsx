import type { EntityData } from '../types/entity';
import { formatTimestamp } from '../utils/timestamp';

export function EntityTimestamp(props: {
  entity: EntityData;
  overrideTimeStamp?: number;
}) {
  const timestamp = () => {
    if (props.overrideTimeStamp !== undefined) return props.overrideTimeStamp;
    if (props.entity.updatedAt) return props.entity.updatedAt.getTime();
    return Date.now();
  };
  return <>{formatTimestamp(timestamp())}</>;
}
