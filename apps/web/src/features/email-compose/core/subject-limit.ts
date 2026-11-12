import type { UserProvider } from '@service-email/generated/schemas/userProvider';
import { subjectLimitChars } from './constants';

export function subjectLimitHint(
  subject: string,
  provider?: UserProvider
): string | undefined {
  const limit = subjectLimitChars(provider);
  if (limit === undefined || subject.length <= limit) return undefined;
  return `Subject is ${subject.length} characters. Outlook allows ${limit}.`;
}
