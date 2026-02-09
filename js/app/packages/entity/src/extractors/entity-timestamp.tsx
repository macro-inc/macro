import type { EntityData } from '../types/entity';
import { formatTimestamp } from '../utils/timestamp';

export function EntityTimestamp(props: {
  entity: EntityData;
  overrideTimeStamp?: number;
}) {
  const timestamp = () =>
    props.overrideTimeStamp ?? props.entity.updatedAt ?? Date.now();
  return <>{formatTimestamp(timestamp())}</>;
}
