import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import FilePdfIcon from '@icon/system/regular/file-pdf.svg';
import HashIcon from '@icon/system/regular/hash-straight.svg';
import PhoneCallIcon from '@icon/system/regular/phone-call.svg';
import { match } from 'ts-pattern';
import { type ContentHitData, hitHasSender } from '../types/search';

/**
 * Gets the sender ID from a content hit, if applicable
 * @internal
 */
export function getSenderId(hit: ContentHitData): string | undefined {
  return hitHasSender(hit) ? hit.senderId : undefined;
}

/**
 * Gets the appropriate icon for a content hit type
 * @internal
 */
export function getSearchIcon(hit: ContentHitData) {
  return match(hit)
    .with({ type: 'md' }, () => FileIcon)
    .with({ type: 'pdf' }, () => FilePdfIcon)
    .with({ type: 'channel' }, () => HashIcon)
    .with({ type: 'email' }, () => EnvelopeIcon)
    .with({ type: 'call_record' }, () => PhoneCallIcon)
    .otherwise(() => FileIcon);
}
