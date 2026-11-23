import { describe, expect, it } from 'vitest';
import {
  type BookingAccount,
  bookingAccountIssue,
  bookingAccountLabel,
} from './booking-account';

const PERSONAL: BookingAccount = {
  emailLinkId: 'personal',
  emailAddress: 'alex@example.com',
  primary: true,
  needsReconnect: false,
  videoMeetings: true,
};
const WORK: BookingAccount = {
  emailLinkId: 'work',
  emailAddress: 'alex@work.example',
  primary: false,
  needsReconnect: false,
  videoMeetings: false,
};

describe('booking accounts', () => {
  it('shows the primary account until a link names another', () => {
    expect(bookingAccountLabel({ emailLinkId: null }, [PERSONAL, WORK])).toBe(
      'alex@example.com'
    );
    expect(bookingAccountLabel({ emailLinkId: 'work' }, [PERSONAL, WORK])).toBe(
      'alex@work.example'
    );
    expect(bookingAccountLabel({ emailLinkId: null }, [PERSONAL])).toBe(
      undefined
    );
  });

  it('refuses an account that is gone, but not while accounts load', () => {
    const removed = { emailLinkId: 'removed', googleMeet: false };
    expect(bookingAccountIssue(removed, [PERSONAL, WORK])).toMatch(
      'no longer connected'
    );
    expect(bookingAccountLabel(removed, [PERSONAL, WORK])).toBe(
      'Disconnected account'
    );
    expect(bookingAccountIssue(removed, [])).toBe(undefined);
  });

  it('refuses a video meeting on an account that cannot add one', () => {
    expect(
      bookingAccountIssue({ emailLinkId: 'work', googleMeet: true }, [
        PERSONAL,
        WORK,
      ])
    ).toMatch("can't add video meetings");
    expect(
      bookingAccountIssue({ emailLinkId: 'work', googleMeet: false }, [
        PERSONAL,
        WORK,
      ])
    ).toBe(undefined);
  });
});
