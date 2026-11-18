import { describe, expect, it } from 'vitest';
import { message } from '../tests/messages';
import { formatShortDateTime } from './format-email-date';
import {
  readReceiptDetail,
  readReceiptLabel,
  readReceiptPixelPrefixes,
  showsReadReceiptPixel,
  type ViewerInbox,
} from './read-receipt';

const first = '2026-10-20T09:15:00Z';
const last = '2026-10-21T16:40:00Z';

const work: ViewerInbox = {
  id: 'work',
  email_address: 'Me@Work.example',
  sendAs: [{ email_address: 'team@work.example' }],
};
const personal: ViewerInbox = {
  id: 'personal',
  email_address: 'me@personal.example',
};
const delegated: ViewerInbox = {
  id: 'boss',
  email_address: 'boss@work.example',
  sendAs: null,
};
const inboxes = [work, personal, delegated];

describe('read receipt pixel visibility', () => {
  it('shows the pixel on a copy the viewer received from someone else', () => {
    const received = message('received', {
      link_id: 'personal',
      from: { email: 'alice@elsewhere.example' },
    });
    expect(showsReadReceiptPixel(received, inboxes)).toBe(true);
  });

  it.each([
    ['their primary address', 'me@work.example'],
    ['a send-as alias', 'TEAM@work.example'],
    ['an inbox they are a delegate of', 'boss@work.example'],
  ])('hides the pixel on a copy the viewer sent from %s', (_, from) => {
    const sent = message('sent', { link_id: 'work', from: { email: from } });
    expect(showsReadReceiptPixel(sent, inboxes)).toBe(false);
  });

  it('hides the pixel on a copy the sender also received', () => {
    const ccSelf = message('cc-self', {
      link_id: 'personal',
      from: { email: 'me@work.example' },
      cc: [{ email: 'me@personal.example' }],
    });
    expect(showsReadReceiptPixel(ccSelf, inboxes)).toBe(false);
  });

  it('hides the pixel on a Gmail sent copy from an unrecognised address', () => {
    const sent = message('sent', {
      link_id: 'boss',
      from: { email: 'unlisted-alias@work.example' },
      labels: [{ provider_label_id: 'SENT' }],
    });
    expect(showsReadReceiptPixel(sent, inboxes)).toBe(false);
  });

  it('hides the pixel on copies seen through sharing or before inboxes load', () => {
    const shared = message('shared', {
      link_id: 'someone-else',
      from: { email: 'alice@elsewhere.example' },
    });
    expect(showsReadReceiptPixel(shared, inboxes)).toBe(false);
    expect(showsReadReceiptPixel({ ...shared, link_id: 'personal' }, [])).toBe(
      false
    );
  });
});

describe('read receipts', () => {
  it('builds one pixel prefix per host without doubled slashes', () => {
    expect(
      readReceiptPixelPrefixes([
        'https://gateway.macro.com/email',
        'http://localhost:8087/',
      ])
    ).toEqual([
      'https://gateway.macro.com/email/opens/',
      'http://localhost:8087/opens/',
    ]);
  });

  it('labels unopened and opened messages', () => {
    expect(readReceiptLabel({ openCount: 0 })).toBe('Not opened');
    expect(readReceiptDetail({ openCount: 0 })).toBe('Not opened yet');
    expect(
      readReceiptLabel({
        openCount: 2,
        firstOpenedAt: first,
        lastOpenedAt: last,
      })
    ).toBe('Opened');
  });

  it('describes a single open by its time', () => {
    expect(
      readReceiptDetail({
        openCount: 1,
        firstOpenedAt: last,
        lastOpenedAt: last,
      })
    ).toBe(`Opened ${formatShortDateTime(last)}`);
  });

  it('describes repeat opens with count, first and last times', () => {
    expect(
      readReceiptDetail({
        openCount: 3,
        firstOpenedAt: first,
        lastOpenedAt: last,
      })
    ).toBe(
      `Opened 3 times · first ${formatShortDateTime(first)} · last ${formatShortDateTime(last)}`
    );
  });
});
