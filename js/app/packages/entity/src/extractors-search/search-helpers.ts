import { match } from 'ts-pattern';
import type { ContentHitData } from '../types/search';
import FileTextIcon from '@icon/regular/file-text.svg';
import FilePdfIcon from '@icon/regular/file-pdf.svg';
import HashIcon from '@icon/regular/hash.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';

/**
 * Gets the sender ID from a content hit, if applicable
 * @internal
 */
export function getSenderId(hit: ContentHitData): string | undefined {
  if (hit.type === 'channel' || hit.type === 'email') {
    return hit.senderId;
  }
}

/**
 * Gets the appropriate icon for a content hit type
 * @internal
 */
export function getSearchIcon(hit: ContentHitData) {
  return match(hit)
    .with({ type: 'md' }, () => FileTextIcon)
    .with({ type: 'pdf' }, () => FilePdfIcon)
    .with({ type: 'channel' }, () => HashIcon)
    .with({ type: 'email' }, () => EnvelopeIcon)
    .otherwise(() => FileTextIcon);
}
