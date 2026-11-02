import { describe, expect, it } from 'vitest';
import { message, thread } from '../tests/fixtures';
import {
  selectEmlMessage,
  selectThreadMessages,
  selectThreadSender,
} from './thread-messages';

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
  it('targets no sender while the viewer is unknown, so a sender action cannot hit the viewer', () => {
    const own = message('own', {
      from: { email: 'viewer@example.com' },
      internal_date_ts: '2026-09-01T00:00:00Z',
    });
    const reply = message('reply', {
      from: { email: 'external@example.com' },
      internal_date_ts: '2026-09-02T00:00:00Z',
    });
    expect(selectThreadSender(thread([own, reply]))).toBeUndefined();
    expect(selectThreadSender(thread([own, reply]), 'viewer@example.com')).toBe(
      'external@example.com'
    );
  });
  it('never offers a deleted draft as the reply draft or the draft to edit', () => {
    const parent = message('parent');
    const live = message('live', {
      is_draft: true,
      replying_to_id: 'parent',
      updated_at: '2026-09-02T10:00:00Z',
    });
    const deleted = message('deleted', {
      is_draft: true,
      replying_to_id: 'parent',
      updated_at: '2026-09-03T10:00:00Z',
      operation: { state: 'DELETED', revision: '3' },
    });
    expect(
      selectThreadMessages(thread([parent, live, deleted])).draftMap
    ).toEqual({ parent: live });
    const standalone = message('standalone', {
      is_draft: true,
      operation: { state: 'DELETED', revision: '1' },
    });
    expect(selectThreadMessages(thread([standalone])).messages).toEqual([]);
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
  it('downloads the newest sent or received message, never a draft or pending send', () => {
    const received = message('received', {
      provider_id: 'p-received',
      internal_date_ts: '2026-09-01T00:00:00Z',
    });
    const sent = message('sent', {
      provider_id: 'p-sent',
      internal_date_ts: '2026-09-02T00:00:00Z',
    });
    const pending = message('pending', {
      provider_id: null,
      internal_date_ts: '2026-09-03T00:00:00Z',
    });
    const draft = message('draft', {
      is_draft: true,
      provider_id: 'p-draft',
      internal_date_ts: '2026-09-04T00:00:00Z',
    });
    expect(
      selectEmlMessage(thread([draft, pending, sent, received]))?.db_id
    ).toBe('sent');
    expect(selectEmlMessage(thread([draft]))).toBeUndefined();
  });
  it('downloads the newest message when timestamps are missing or mixed', () => {
    const received = message('received', {
      provider_id: 'p-received',
      internal_date_ts: '2026-09-02T00:00:00Z',
    });
    const sent = message('sent', {
      provider_id: 'p-sent',
      internal_date_ts: null,
      sent_at: '2026-09-03T00:00:00Z',
    });
    const synced = message('synced', {
      provider_id: 'p-synced',
      internal_date_ts: null,
      created_at: '2026-09-01T00:00:00Z',
    });
    for (const order of [
      [received, sent, synced],
      [sent, synced, received],
      [synced, received, sent],
    ]) {
      expect(selectEmlMessage(thread(order))?.db_id).toBe('sent');
    }
  });
});
