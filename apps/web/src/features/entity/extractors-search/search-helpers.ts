import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import FilePdfIcon from '@phosphor/file-pdf.svg';
import HashIcon from '@phosphor/hash-straight.svg';
import PhoneCallIcon from '@phosphor/phone-call.svg';
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
