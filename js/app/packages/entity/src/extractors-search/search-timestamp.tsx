import type {
  ContentHitData,
  ChannelContentHitData,
  EmailContentHitData,
} from '../types/search';
import { formatRelativeTimestamp } from '../utils/timestamp';

interface SearchTimestampProps {
  hit?: ContentHitData;
}

/**
 * Gets timestamp from content hit if available
 */
function getTimestamp(hit: ContentHitData): number | undefined {
  if (hit.type === 'channel') {
    return (hit as ChannelContentHitData).sentAt;
  }
  if (hit.type === 'email') {
    return (hit as EmailContentHitData).sentAt;
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
