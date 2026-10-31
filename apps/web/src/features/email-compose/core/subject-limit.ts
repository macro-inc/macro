import { subjectLimitChars } from './constants';

export function subjectLimitHint(
  subject: string,
  provider?: 'GMAIL' | 'OUTLOOK'
): string | undefined {
  const limit = subjectLimitChars(provider);
  if (limit === undefined || subject.length <= limit) return undefined;
  return `Subject is ${subject.length} characters. Outlook allows ${limit}.`;
}
