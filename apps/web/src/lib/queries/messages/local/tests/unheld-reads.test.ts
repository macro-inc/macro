import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetUnheldRead,
  noteUnheldRead,
  resetUnheldReads,
  unheldReads,
} from '../unheld-reads';

const page = { channelId: 'a-channel' };
const thread = { channelId: 'a-channel', rootId: 'a-root' };

beforeEach(() => {
  localStorage.clear();
  resetUnheldReads();
});

describe('unheld reads', () => {
  it('keeps a channel page and a thread of the same channel apart', () => {
    noteUnheldRead(page);
    noteUnheldRead(thread);
    noteUnheldRead(page);

    expect(unheldReads()).toEqual([page, thread]);

    forgetUnheldRead(page);

    expect(unheldReads()).toEqual([thread]);
  });

  it('leaves what an earlier page noted unless told that page is gone', () => {
    noteUnheldRead(thread);
    // A new page: nothing noted in memory, the note still in storage.
    resetUnheldReads();

    forgetUnheldRead(thread);
    expect(unheldReads()).toEqual([thread]);

    forgetUnheldRead(thread, true);
    expect(unheldReads()).toEqual([]);
  });

  it('keeps only the latest fifty', () => {
    for (let n = 0; n < 55; n += 1) noteUnheldRead({ channelId: `c${n}` });

    const noted = unheldReads();
    expect(noted).toHaveLength(50);
    expect(noted[0]).toEqual({ channelId: 'c5' });
    // One pushed out can be noted again.
    noteUnheldRead({ channelId: 'c0' });
    expect(unheldReads().at(-1)).toEqual({ channelId: 'c0' });
  });

  it('reads nothing from a value it did not write', () => {
    localStorage.setItem('channel-read-awaiting-device:v1', '{"not":"a list"}');

    expect(unheldReads()).toEqual([]);
  });
});
