import PhoneCallIcon from '@icon/wide-call.svg';
import FilePdfIcon from '@lucide/file-text.svg';
import FileTextIcon from '@lucide/file-text.svg';
import HashIcon from '@lucide/hash.svg';
import EnvelopeIcon from '@lucide/mail.svg';
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
    .with({ type: 'md' }, () => FileTextIcon)
    .with({ type: 'pdf' }, () => FilePdfIcon)
    .with({ type: 'channel' }, () => HashIcon)
    .with({ type: 'email' }, () => EnvelopeIcon)
    .with({ type: 'call_record' }, () => PhoneCallIcon)
    .otherwise(() => FileTextIcon);
}
