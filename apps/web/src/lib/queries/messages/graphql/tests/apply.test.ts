import { describe, expect, it } from 'vitest';
import {
  removeTimelineMessages,
  trimLatestPage,
  upsertThreadReply,
  upsertTimelineEntries,
} from '../apply';
import { at, ids, messageEntry, page, reply, timeline } from './fixtures';

describe('upsertTimelineEntries', () => {
  const loaded = timeline(
    page([messageEntry('m6', 6), messageEntry('m4', 4)], {
      next_cursor: { created_at: at(4), id: 'm4' },
    }),
    page([messageEntry('m3', 3), messageEntry('m2', 2)], {
      next_cursor: { created_at: at(2), id: 'm2' },
    })
  );

  it('replaces a loaded row where it is', () => {
    const next = upsertTimelineEntries(loaded, [
      messageEntry('m3', 3, { content: 'edited' }),
    ]);
    expect(ids(next)).toEqual(ids(loaded));
    const entry = next?.pages[1].entries[0];
    expect(entry?.type === 'message' && entry.message.content).toBe('edited');
  });

  it('adds a new row at its position in the page that contains it', () => {
    const next = upsertTimelineEntries(loaded, [
      messageEntry('m7', 7),
      messageEntry('m5', 5),
    ]);
    expect(ids(next)).toEqual([
      ['m7', 'm6', 'm5', 'm4'],
      ['m3', 'm2'],
    ]);
  });

  it('leaves a row older than the loaded span for the page that brings it', () => {
    const next = upsertTimelineEntries(loaded, [messageEntry('m1', 1)]);
    expect(next).toBe(loaded);
  });

  it('leaves a row newer than a page that is not the latest', () => {
    const around = timeline(
      page([messageEntry('m4', 4)], {
        previous_cursor: { created_at: at(4), id: 'm4' },
      })
    );
    expect(upsertTimelineEntries(around, [messageEntry('m9', 9)])).toBe(around);
  });
});

describe('removeTimelineMessages', () => {
  it('drops removed roots and removed preview replies', () => {
    const loaded = timeline(
      page([
        messageEntry('m2', 2),
        messageEntry('m1', 1, {
          thread: {
            reply_count: 2,
            latest_reply_at: at(4),
            preview: [reply('r1', 'm1', 3), reply('r2', 'm1', 4)],
          },
        }),
      ])
    );
    const next = removeTimelineMessages(loaded, new Set(['m2', 'r1']));
    expect(ids(next)).toEqual([['m1']]);
    const entry = next?.pages[0].entries[0];
    expect(
      entry?.type === 'message' &&
        entry.message.thread.preview.map((item) => item.id)
    ).toEqual(['r2']);
  });

  it('keeps the same data when nothing loaded was removed', () => {
    const loaded = timeline(page([messageEntry('m1', 1)]));
    expect(removeTimelineMessages(loaded, new Set(['other']))).toBe(loaded);
  });
});

describe('upsertThreadReply', () => {
  it('replaces a loaded reply and appends a new one', () => {
    const replies = [reply('r1', 'm1', 1), reply('r2', 'm1', 2)];
    const edited = { ...reply('r1', 'm1', 1), content: 'edited' };
    expect(upsertThreadReply(replies, edited)).toEqual([edited, replies[1]]);
    const added = reply('r3', 'm1', 3);
    expect(upsertThreadReply(replies, added)).toEqual([...replies, added]);
  });
});

describe('trimLatestPage', () => {
  it('keeps the newest rows and continues from the last one kept', () => {
    const latest = page(
      [messageEntry('m3', 3), messageEntry('m2', 2), messageEntry('m1', 1)],
      { next_cursor: { created_at: at(1), id: 'm1' } }
    );
    expect(trimLatestPage(latest, 3)).toBe(latest);
    const trimmed = trimLatestPage(latest, 2);
    expect(
      trimmed.entries.map(
        (entry) => entry.type === 'message' && entry.message.id
      )
    ).toEqual(['m3', 'm2']);
    expect(trimmed.next_cursor).toEqual({ created_at: at(2), id: 'm2' });
  });
});
