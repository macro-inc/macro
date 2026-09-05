import { describe, expect, it } from 'vitest';
import { message, thread } from '../tests/fixtures';
import { selectThreadMessages } from './thread-messages';

describe('thread message selection', () => {
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
