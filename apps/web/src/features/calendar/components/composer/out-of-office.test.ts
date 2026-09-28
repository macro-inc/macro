import { describe, expect, it } from 'vitest';
import { outOfOfficeNoticeFor } from './out-of-office';

describe('outOfOfficeNoticeFor', () => {
  it('discloses the auto-decline behavior for each mode', () => {
    expect(
      outOfOfficeNoticeFor('decline_all_conflicting_invitations').effect
    ).toContain('decline all conflicting invitations');

    expect(
      outOfOfficeNoticeFor('decline_only_new_conflicting_invitations').effect
    ).toContain('newly received conflicting invitations');

    // No decline mode still discloses the away status, without promising declines.
    const none = outOfOfficeNoticeFor(undefined);
    expect(none.effect).toContain('away');
    expect(none.effect).not.toContain('decline all');
    expect(outOfOfficeNoticeFor('decline_none').effect).toBe(none.effect);
  });

  it('surfaces a decline message and drops a blank one', () => {
    expect(
      outOfOfficeNoticeFor('decline_none', 'On vacation').declineMessage
    ).toBe('On vacation');
    expect(
      outOfOfficeNoticeFor('decline_none', '   ').declineMessage
    ).toBeUndefined();
  });
});
