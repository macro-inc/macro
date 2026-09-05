import type { ApiMessage } from '@service-email/generated/schemas';
import type { ReplyType } from './replyType';

const NO_SUBJECT = '[No subject]';

/**
 * A thread subject as it should be shown: accumulated "re:" prefixes stripped,
 * and a name for the blank case so callers never have to render an empty string.
 */
export const displaySubject = (subject: string | null | undefined): string => {
  // Strip before testing for blank: a subject of just "Re:" is empty once the
  // prefix is gone, and callers rely on this never returning an empty string.
  const stripped = subject?.replace(/^(\s*re:\s*)+/i, '').trim();
  return stripped || NO_SUBJECT;
};

export const isPlaceholderSubject = (title: string): boolean =>
  title === NO_SUBJECT;

export const getSubjectText = (
  replyingTo: ApiMessage | undefined,
  replyType: ReplyType | undefined
) => {
  if (!replyingTo) return '';
  if (replyType === 'reply-all' || replyType === 'reply') {
    const subject = replyingTo.subject;
    if (subject && /^re:/i.test(subject)) {
      return subject;
    } else {
      return `Re: ${subject}`;
    }
  } else if (replyType === 'forward') {
    return `Fwd: ${replyingTo.subject}`;
  } else {
    return replyingTo.subject ?? '';
  }
};
