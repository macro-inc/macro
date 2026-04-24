import type { DateValue } from '@core/util/date';
import { type ContentHitData, hitHasSender } from '../types/search';
import { formatRelativeTimestamp } from '../utils/timestamp';

interface SearchTimestampProps {
  hit?: ContentHitData;
}

function getTimestamp(hit: ContentHitData): DateValue | undefined {
  return hitHasSender(hit) ? hit.sentAt : undefined;
}

/**
 * Displays the timestamp of a search hit (for channel/email)
 */
export function SearchTimestamp(props: SearchTimestampProps) {
  const timestamp = () => (props.hit ? getTimestamp(props.hit) : undefined);

  const formattedTimestamp = () => {
    const ts = timestamp();
    return ts ? formatRelativeTimestamp(ts) : '';
  };

  return <>{formattedTimestamp()}</>;
}
