import { describe, expect, it } from 'vitest';
import { message, thread } from '../tests/fixtures';
import { selectThreadMessages, selectThreadSender } from './thread-messages';

describe('thread message selection', () => {
  it.each([false, true])(
    'selects the most recently edited reply draft independently of transport order (reverse=%s)',
    (reverse) => {
      const older = message('older-draft', {
        is_draft: true,
        replying_to_id: 'parent',
        updated_at: '2026-09-01T10:00:00Z',
        internal_date_ts: '2026-09-03T10:00:00Z',
      });
      const newer = message('newer-draft', {
        is_draft: true,
        replying_to_id: 'parent',
        updated_at: '2026-09-02T10:00:00Z',
        internal_date_ts: '2026-09-01T10:00:00Z',
      });
      const drafts = reverse ? [newer, older] : [older, newer];
      expect(selectThreadMessages(thread(drafts)).draftMap.parent).toBe(newer);
      // Local replies do not have received/sent timestamps.
      older.internal_date_ts = undefined;
      newer.internal_date_ts = undefined;
      expect(selectThreadMessages(thread(drafts)).draftMap.parent).toBe(newer);
    }
  );
  it('targets the original external sender for sender actions regardless of transport order', () => {
    const original = message('original', {
      from: { email: 'originator@example.com' },
      internal_date_ts: '2026-09-01T00:00:00Z',
    });
    const later = message('later', {
      from: { email: 'newer@example.com' },
      internal_date_ts: '2026-09-06T00:00:00Z',
    });
    const viewer = message('viewer', {
      from: { email: 'VIEWER@example.com' },
      internal_date_ts: '2026-08-01T00:00:00Z',
    });
    const messages = [later, original, viewer];
    expect(selectThreadSender(thread(messages), 'viewer@example.com')).toBe(
      'originator@example.com'
    );
    expect(
      selectThreadSender(thread([...messages].reverse()), 'viewer@example.com')
    ).toBe('originator@example.com');
    expect(messages).toEqual([later, original, viewer]);
    expect(
      selectThreadSender(thread([viewer]), 'viewer@example.com')
    ).toBeUndefined();
    expect(selectThreadSender(thread([]))).toBeUndefined();
  });
  it('orders messages chronologically without mutating the source and separates reply drafts', () => {
    const newer = message('new', { internal_date_ts: '2026-09-02T10:00:00Z' });
    const older = message('old');
    const reply = message('reply', { is_draft: true, replying_to_id: 'old' });
    const empty = message('empty', {
      is_draft: true,
      replying_to_id: 'new',
      body_html_sanitized: '  ',
    });
    const standalone = message('standalone', { is_draft: true });
    const input = thread([newer, older, reply, empty, standalone]);
    const output = selectThreadMessages(input);
    expect(output.filtered.map((message) => message.db_id)).toEqual([
      'old',
      'new',
    ]);
    expect(output.draftMap).toEqual({ old: reply });
    expect(input.messages[0]).toBe(newer);
    expect(output.messages).toContain(standalone);
  });
});
