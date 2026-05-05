import { formatVideoTimestamp } from '@core/util/duration';
import {
  type ContentHitData,
  hitHasSender,
  isCallRecordHit,
} from '../types/search';
import { formatRelativeTimestamp } from '../utils/timestamp';

interface SearchTimestampProps {
  hit?: ContentHitData;
}

/**
 * Displays the timestamp of a search hit (for channel/email/call_record)
 */
export function SearchTimestamp(props: SearchTimestampProps) {
  const formatted = () => {
    const hit = props.hit;
    if (!hit) return '';
    if (isCallRecordHit(hit)) return formatVideoTimestamp(hit.videoSeconds);
    if (hitHasSender(hit)) return formatRelativeTimestamp(hit.sentAt);
    return '';
  };

  return <>{formatted()}</>;
}
