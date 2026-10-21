import { describe, expect, it } from 'vitest';
import { formatShortDateTime } from './format-email-date';
import {
  readReceiptDetail,
  readReceiptLabel,
  readReceiptPixelPrefixes,
} from './read-receipt';

const first = '2026-10-20T09:15:00Z';
const last = '2026-10-21T16:40:00Z';

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
