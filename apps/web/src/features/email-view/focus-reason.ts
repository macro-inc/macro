import type { EmailFocus } from '@entity';
import { match } from 'ts-pattern';

type EmailFocusReason = {
  label: string;
  /**
   * Dot color. Only a reason asking the owner to act has one. Follow up is
   * blue, not the accent: the accent can be orange, which reads as Reply
   * needed's amber beside it.
   */
  fill?: string;
};

/**
 * The one reason a Focus row shows: what the owner owes first, then what the
 * mail is, then who it's from. `OTHER` and the categories that keep a thread out
 * of Focus explain nothing, so they show no reason. Neither does a category
 * this build doesn't know, since the server ships separately.
 */
export function emailFocusReason(
  focus: Pick<EmailFocus, 'category' | 'needsReply' | 'needsFollowUp'>
): EmailFocusReason | undefined {
  if (focus.needsReply) {
    return { label: 'Reply needed', fill: 'var(--color-warning)' };
  }

  if (focus.needsFollowUp) {
    return { label: 'Follow up', fill: 'var(--color-blue)' };
  }

  return match(focus.category)
    .returnType<EmailFocusReason | undefined>()
    .with('CALENDAR', () => ({ label: 'Calendar change' }))
    .with('CUSTOMER', () => ({ label: 'Customer' }))
    .with('TEAM', () => ({ label: 'Teammate' }))
    .with('KNOWN', () => ({ label: 'Contact' }))
    .with('OTHER', 'OUTREACH', 'AUTOMATED', 'LOW_RELEVANCE', () => undefined)
    .exhaustive(() => undefined);
}
