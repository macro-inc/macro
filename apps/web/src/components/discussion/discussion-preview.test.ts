import type { MessageListItem } from '@service-storage/messages';
import { describe, expect, it } from 'vitest';
import { discussionPreview } from './discussion-preview';

function root(id: string, sender: string, time: string): MessageListItem {
  return {
    id,
    parent: { type: 'initiative', id: 'project' },
    sender_id: sender,
    content: id,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: time,
    updated_at: time,
    state: {
      root_id: id,
      user_id: sender,
      anchor: null,
      resolved: false,
      created_at: time,
      updated_at: time,
    },
    thread: { reply_count: 0, preview: [], latest_reply_at: null },
  };
}

describe('discussion entry data', () => {
  it('represents an empty discussion', () => {
    expect(discussionPreview([])).toEqual({
      newest: undefined,
      count: 0,
      commenters: [],
    });
  });

  it('uses the newest live root and counts replies without loading full threads', () => {
    const old = root('old', 'author-a', '2026-10-01T00:00:00Z');
    const newest = root('new', 'author-b', '2026-10-03T00:00:00Z');
    old.thread.reply_count = 4;
    old.thread.preview = [root('reply', 'author-b', '2026-10-02T00:00:00Z')];
    const preview = discussionPreview([old, newest]);
    expect(preview.newest?.id).toBe('new');
    expect(preview.count).toBe(6);
    expect(preview.commenters.map((commenter) => commenter.sender_id)).toEqual([
      'author-b',
      'author-a',
    ]);
  });

  it('excludes deleted threads and anchored roots but retains replies to deleted messages', () => {
    const removed = root('removed', 'author-a', '2026-10-05T00:00:00Z');
    removed.state.deleted_at = removed.created_at;
    const anchored = root('anchor', 'author-a', '2026-10-04T00:00:00Z');
    anchored.state.anchor = { type: 'markdown', mark_id: 'mark' };
    const deletedMessage = root('deleted', 'author-b', '2026-10-03T00:00:00Z');
    deletedMessage.deleted_at = deletedMessage.created_at;
    deletedMessage.thread.reply_count = 2;
    const visible = root('visible', 'author-c', '2026-10-01T00:00:00Z');
    const preview = discussionPreview([
      removed,
      anchored,
      deletedMessage,
      visible,
    ]);
    expect(preview.newest?.id).toBe('visible');
    expect(preview.count).toBe(3);
    expect(preview.commenters.map((commenter) => commenter.sender_id)).toEqual([
      'author-c',
    ]);
  });
});
