import type { DateValue } from '@core/util/date';
import type { ContentHitData } from '../types/search';
import { formatRelativeTimestamp } from '../utils/timestamp';

interface SearchTimestampProps {
  hit?: ContentHitData;
}

/**
 * Gets timestamp from content hit if available
 */
function getTimestamp(hit: ContentHitData): DateValue | undefined {
  switch (hit.type) {
    case 'email':
    case 'channel':
      return hit.sentAt;
  }
  return undefined;
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
