/**
 * @vitest-environment jsdom
 */

import { makeInputValuePersistenceKey } from '@channel/Input/utils/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNEL, ME } from './channel-writes-server';
import {
  type ChannelWritesWorld,
  createChannelWritesWorld,
} from './channel-writes-world';

let world: ChannelWritesWorld;

beforeEach(async () => {
  world = await createChannelWritesWorld();
});
afterEach(async () => {
  await world.dispose();
});

const contents = () => world.page.rows().map((row) => row.content);
/** What told the user something failed; reads failing offline do not. */
const failures = () =>
  world.events.filter(
    (event) => event.kind === 'toast' || !event.message.includes('[Network]')
  );
const applied = () =>
  world.server
    .applied()
    .map((write) => `${write.operation}:${write.content ?? write.emoji}`);

/**
 * Open a channel with one earlier message, and let its page reach the
 * device cache.
 */
async function openChannel() {
  world.server.seed('earlier');
  world.page.open();
  await world.advance(2_000);
}

describe('a channel message write', () => {
  it('is sent through the queue and answered with its message', async () => {
    await openChannel();
    const hello = world.page.send('hello');
    const sent = await world.settle(hello.done);

    expect(sent?.id).toBe(hello.id);
    expect(world.server.applied().map((write) => write.messageId)).toEqual([
      hello.id,
    ]);
    expect(world.rest).toEqual([]);
    expect(contents()).toEqual(['hello', 'earlier']);
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);
  });

  it('stays on REST without the device cache, and for a document', async () => {
    world.cacheEnabled = false;
    await world.reload();
    const channel = world.page.send('to the channel');
    await world.settle(channel.done);

    world.cacheEnabled = true;
    await world.reload();
    const document = { type: 'document' as const, id: 'document-1' };
    const comment = world.page.send('on the document', document);
    // Each hook answers with the message REST returned, as it always has:
    // only a queued channel write answers with nothing.
    const posted = await world.settle(comment.done);
    const edited = await world.settle(
      world.page.edit(comment.id, 'edited', document).done
    );
    const reacted = await world.settle(
      world.page.react(comment.id, '👍', document).done
    );
    const removed = await world.settle(
      world.page.remove(comment.id, document).done
    );
    expect([posted?.id, edited?.id, reacted?.id, removed?.id]).toEqual([
      comment.id,
      comment.id,
      comment.id,
      comment.id,
    ]);

    expect(world.rest).toEqual([
      { method: 'post', parent: CHANNEL, messageId: channel.id },
      { method: 'post', parent: document, messageId: comment.id },
      { method: 'patch', parent: document, messageId: comment.id },
      { method: 'react', parent: document, messageId: comment.id },
      { method: 'delete', parent: document, messageId: comment.id },
    ]);
    expect(world.server.received).toEqual([]);
    expect(world.queue.entries).toEqual([]);
  });
});

describe('messages typed offline', () => {
  it('reach the server in typed order, once each, across a reload', async () => {
    await openChannel();
    await world.setOffline(true);
    const first = world.page.send('first');
    await world.advance(1_000);
    const second = world.page.send('second');
    await world.advance(1_000);

    expect(contents()).toEqual(['second', 'first', 'earlier']);
    expect(world.queued().map((write) => write.messageId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(first.outcome()).toEqual({ status: 'pending' });

    // The tab reloads while still offline; the queue keeps both writes.
    await world.reload();
    world.page.open();
    await world.advance(1_000);
    expect(contents()).toEqual(['second', 'first', 'earlier']);
    expect(world.page.queuedWrites.holdsQueuedChannelWrite(CHANNEL.id)).toBe(
      true
    );

    await world.setOffline(false);
    await world.advance(5_000);

    expect(applied()).toEqual([
      'PostChannelMessage:first',
      'PostChannelMessage:second',
    ]);
    expect(world.queue.entries).toEqual([]);
    expect(contents()).toEqual(['second', 'first', 'earlier']);
    expect(world.page.queuedWrites.holdsQueuedChannelWrite(CHANNEL.id)).toBe(
      false
    );
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);
  });

  it('are sent once when a reload loses the answer to one in flight', async () => {
    await openChannel();
    await world.setOffline(true);
    const first = world.page.send('first');
    await world.advance(1_000);
    const second = world.page.send('second');
    await world.advance(1_000);

    // Back online, the server stores the first message, but its answer is
    // lost when the tab reloads.
    world.server.state.loseResponses = true;
    await world.setOffline(false);
    await world.advance(1_000);
    expect(applied()).toEqual(['PostChannelMessage:first']);

    await world.reload();
    world.server.state.loseResponses = false;
    world.page.open();
    await world.advance(1_000);
    // The server stamped the first message when it stored it, after the
    // second, still queued, was typed.
    expect(contents()).toEqual(['first', 'second', 'earlier']);

    // A message typed after the reload waits behind both.
    const third = world.page.send('third');
    await world.advance(1_000);
    expect(contents()).toEqual(['third', 'first', 'second', 'earlier']);
    expect(world.queued().map((write) => write.messageId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);

    // The first write's lease from the old tab runs out, and it is sent again.
    const sent = await world.settle(third.done, 10 * 60_000);

    expect(sent).toBeUndefined();
    expect(applied()).toEqual([
      'PostChannelMessage:first',
      'PostChannelMessage:second',
      'PostChannelMessage:third',
    ]);
    expect(
      world.server.received
        .filter((write) => write.messageId === first.id)
        .map((write) => write.outcome)
    ).toEqual(['applied', 'replayed']);
    expect(world.queue.entries).toEqual([]);
    expect(contents()).toEqual(['third', 'second', 'first', 'earlier']);
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);
  });
});

describe('changes to a message whose post is still queued', () => {
  /** The rows the view rendered from `from` on, for one message. */
  const renderedFrom = (from: number, id: string) => {
    const rendered = world.seen.slice(from);
    expect(rendered.length).toBeGreaterThan(0);
    return rendered.map((rows) => rows.find((row) => row.id === id));
  };

  it('follow it in order, and two unsent edits collapse to the newer', async () => {
    await openChannel();
    await world.setOffline(true);
    const hello = world.page.send('hello');
    await world.advance(1_000);
    expect(world.page.rows()).toEqual([
      { id: hello.id, content: 'hello', reactions: [] },
      expect.objectContaining({ content: 'earlier' }),
    ]);

    const thumbs = world.page.react(hello.id, '👍');
    await world.advance(1_000);
    expect(world.page.rows()[0]).toEqual({
      id: hello.id,
      content: 'hello',
      reactions: [`👍:${ME}`],
    });

    const firstEdit = world.page.edit(hello.id, 'hello again');
    await world.advance(1_000);
    expect(world.page.rows()[0]).toEqual({
      id: hello.id,
      content: 'hello again',
      reactions: [`👍:${ME}`],
    });

    const secondEdit = world.page.edit(hello.id, 'hello, finally');
    await world.advance(1_000);
    const final = {
      id: hello.id,
      content: 'hello, finally',
      reactions: [`👍:${ME}`],
    };
    expect(world.page.rows()[0]).toEqual(final);
    // The newer edit replaced the unsent one, whose wait ended quietly.
    expect(world.queued()).toEqual([
      expect.objectContaining({
        operation: 'PostChannelMessage',
        content: 'hello',
      }),
      expect.objectContaining({ operation: 'ReactToChannelMessage' }),
      expect.objectContaining({
        operation: 'EditChannelMessage',
        content: 'hello, finally',
      }),
    ]);
    const edits = () =>
      world.spans.filter(
        (span) =>
          span.name === 'channel.write_wait' &&
          span.attributes['channel.write.kind'] === 'edit'
      );
    expect(
      edits().map((span) => span.attributes['channel.write.outcome'])
    ).toEqual(['superseded', undefined]);
    // Its hook settles once it may run again, which needs the connection.
    expect(firstEdit.outcome()).toEqual({ status: 'pending' });

    const from = world.seen.length;
    await world.setOffline(false);
    await world.settle(secondEdit.done);
    await world.advance(2_000);

    expect(applied()).toEqual([
      'PostChannelMessage:hello',
      'ReactToChannelMessage:👍',
      'EditChannelMessage:hello, finally',
    ]);
    expect(hello.outcome().status).toBe('resolved');
    expect(thumbs.outcome().status).toBe('resolved');
    expect(firstEdit.outcome()).toEqual({
      status: 'resolved',
      value: undefined,
    });
    expect(
      edits().map((span) => span.attributes['channel.write.outcome'])
    ).toEqual(['superseded', 'committed']);
    // Each server read in between put the queued changes back on its row.
    expect(renderedFrom(from, hello.id)).toEqual(
      world.seen.slice(from).map(() => final)
    );
    expect(world.page.rows()).toEqual([
      final,
      expect.objectContaining({ content: 'earlier' }),
    ]);
    expect(world.queue.entries).toEqual([]);
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);

    // Waiting on each queued write is traced by ids, never by content.
    const waits = world.spans.filter(
      (span) => span.name === 'channel.write_wait'
    );
    expect(waits.map((span) => span.attributes['channel.write.kind'])).toEqual([
      'post',
      'react',
      'edit',
      'edit',
    ]);
    for (const wait of waits) {
      expect(wait.attributes).toMatchObject({
        'channel.id': CHANNEL.id,
        'message.id': hello.id,
      });
      expect(JSON.stringify(wait.attributes)).not.toContain('hello again');
      expect(JSON.stringify(wait.attributes)).not.toContain('hello, finally');
    }
  });

  it('is deleted with it, and never shown again', async () => {
    await openChannel();
    await world.setOffline(true);
    const bye = world.page.send('bye');
    await world.advance(1_000);
    world.page.react(bye.id, '👍');
    await world.advance(1_000);
    expect(world.page.rows()[0]).toEqual({
      id: bye.id,
      content: 'bye',
      reactions: [`👍:${ME}`],
    });

    const removal = world.page.remove(bye.id);
    await world.advance(1_000);
    expect(contents()).toEqual(['earlier']);
    expect(world.queued().map((write) => write.operation)).toEqual([
      'PostChannelMessage',
      'ReactToChannelMessage',
      'DeleteChannelMessage',
    ]);

    const from = world.seen.length;
    await world.setOffline(false);
    await world.settle(removal.done);
    await world.advance(2_000);

    expect(applied()).toEqual([
      'PostChannelMessage:bye',
      'ReactToChannelMessage:👍',
      'DeleteChannelMessage:undefined',
    ]);
    expect(renderedFrom(from, bye.id).filter(Boolean)).toEqual([]);
    expect(contents()).toEqual(['earlier']);
    expect(world.server.rows().map((row) => row.content)).toEqual(['earlier']);
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);
  });
});

describe('a write restored after a reload', () => {
  it('stays on the timeline when a read replaces it, and holds the cached page back', async () => {
    await openChannel();
    const written = world.pageWrites;
    expect(written).toBeGreaterThan(0);
    // The server sheds load: the write waits, and reads still answer.
    world.server.state.busy = true;
    const waiting = world.page.send('waiting');
    await world.advance(1_000);

    await world.reload();
    world.page.open();
    await world.advance(5_000);
    expect(contents()).toEqual(['waiting', 'earlier']);
    expect(world.page.queuedWrites.holdsQueuedChannelWrite(CHANNEL.id)).toBe(
      true
    );

    // A read of the server's page replaces the rows; the queued post is put
    // back, and the page is not written to the cache while it waits.
    await world.settle(world.page.refetch());
    await world.advance(5_000);
    expect(contents()).toEqual(['waiting', 'earlier']);
    expect(world.pageWrites).toBe(written);

    world.server.state.busy = false;
    await world.advance(90_000, 1_000);

    expect(applied()).toEqual(['PostChannelMessage:waiting']);
    expect(
      world.server.received.some((write) => write.outcome === 'refused:BUSY')
    ).toBe(true);
    expect(world.page.queuedWrites.holdsQueuedChannelWrite(CHANNEL.id)).toBe(
      false
    );
    expect(contents()).toEqual(['waiting', 'earlier']);
    expect(world.pageWrites).toBeGreaterThan(written);
    expect(waiting.id).toBe(world.server.rows()[0]?.id);
    expect(failures()).toEqual([]);
    expect(world.duplicates).toEqual([]);
  });
});

describe('a queued post the server refuses for good', () => {
  const draft = () =>
    JSON.parse(
      localStorage.getItem(
        makeInputValuePersistenceKey({ channelId: CHANNEL.id })
      ) ?? 'null'
    );

  it('leaves its text in the channel draft after a reload', async () => {
    localStorage.clear();
    await openChannel();
    await world.setOffline(true);
    world.page.send('typed on friday');
    await world.advance(1_000);

    // Days later the app starts again; the server no longer takes the post.
    await world.reload();
    world.page.open();
    await world.advance(1_000);
    expect(contents()).toEqual(['typed on friday', 'earlier']);
    world.server.state.refusePosts = 'BAD_USER_INPUT';
    await world.setOffline(false);
    await world.advance(60_000, 1_000);

    expect(world.server.applied()).toEqual([]);
    expect(world.queue.entries).toEqual([]);
    expect(contents()).toEqual(['earlier']);
    // One notice, which offers the text for copying.
    expect(world.events.filter((event) => event.kind === 'toast')).toEqual([
      { kind: 'toast', message: 'Your message was not sent' },
    ]);
    expect(draft()).toBe('typed on friday');
  });

  it('leaves its text in the channel draft when no channel is opened after a reload', async () => {
    localStorage.clear();
    await openChannel();
    await world.setOffline(true);
    world.page.send('typed on friday');
    await world.advance(1_000);

    // The app starts on another view: the shell reads the queue, no channel
    // timeline does.
    await world.reload();
    await world.page.queuedWrites.restoreQueuedChannelWrites(world.page.host);
    world.server.state.refusePosts = 'FORBIDDEN';
    await world.setOffline(false);
    await world.advance(60_000, 1_000);

    expect(world.server.applied()).toEqual([]);
    expect(world.queue.entries).toEqual([]);
    expect(draft()).toBe('typed on friday');
    expect(world.events.filter((event) => event.kind === 'toast')).toEqual([
      { kind: 'toast', message: 'Your message was not sent' },
    ]);
  });

  it('leaves its text in the channel draft on the page that sent it', async () => {
    localStorage.clear();
    await openChannel();
    await world.setOffline(true);
    const post = world.page.send('typed just now');
    await world.advance(1_000);
    world.server.state.refusePosts = 'FORBIDDEN';
    await world.setOffline(false);
    await world.advance(60_000, 1_000);

    expect(post.outcome().status).toBe('rejected');
    expect(contents()).toEqual(['earlier']);
    expect(draft()).toBe('typed just now');
  });
});

describe('a post the queue holds', () => {
  const notSent = (id: string) =>
    world.page.unsentPosts.isChannelPostNotSent(id);

  it('reads as not sent after five seconds, until it is sent', async () => {
    await openChannel();
    const [earlier] = world.page.rows();
    await world.setOffline(true);
    const hello = world.page.send('hello');
    world.page.edit(earlier?.id ?? '', 'earlier, edited');
    world.page.react(earlier?.id ?? '', '👍');
    await world.advance(4_000);
    expect(notSent(hello.id)).toBe(false);

    await world.advance(1_500);
    expect(notSent(hello.id)).toBe(true);
    // Only posts say so: an unsent edit or reaction leaves its row alone.
    expect(notSent(earlier?.id ?? '')).toBe(false);

    // Restored after a reload, it has already waited long enough.
    await world.reload();
    world.page.open();
    await world.advance(100);
    expect(notSent(hello.id)).toBe(true);

    // The queue sends it at its next try, which backs off while offline.
    await world.setOffline(false);
    await world.advance(60_000, 1_000);
    expect(applied()).toEqual([
      'PostChannelMessage:hello',
      'EditChannelMessage:earlier, edited',
      'ReactToChannelMessage:👍',
    ]);
    expect(notSent(hello.id)).toBe(false);
    expect(failures()).toEqual([]);
  });

  it('counts the five seconds from the send, not from a slow cache', async () => {
    await openChannel();
    await world.setOffline(true);
    world.cacheDelayMs = 3_000;
    const hello = world.page.send('hello');
    await world.advance(4_500);
    expect(notSent(hello.id)).toBe(false);

    await world.advance(1_000);
    expect(notSent(hello.id)).toBe(true);
    expect(failures()).toEqual([]);
  });
});
