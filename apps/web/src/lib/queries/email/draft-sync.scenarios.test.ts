import { QUEUE_LEASE_MS } from '@graphql-cache/exchange/mutation-queue-runner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDraftSyncWorld,
  type DraftSyncWorld,
  type Fault,
} from './tests/draft-sync-world';

/**
 * Whole-client scenarios for composing, discarding and sending email. Each
 * drives a headless composer against a simulated server and checks two things:
 * the server ends up with what the user did, and the user was told about a
 * failure only when one needs their action.
 */

let world: DraftSyncWorld;
beforeEach(async () => {
  world = await createDraftSyncWorld();
});
afterEach(async () => {
  await world.dispose();
});

const localOf = async (draftId: string | undefined) =>
  draftId ? await world.page.drafts.readLocalDraft(draftId) : undefined;

/** Fail the first `times` requests for an operation on each draft. */
const failing =
  (operation: string, fault: Fault, times = 1) =>
  (request: { operation: string; nth: number }) =>
    request.operation === operation && request.nth <= times ? fault : undefined;

function expectQuiet() {
  expect(world.failures()).toEqual([]);
  expect(world.errors()).toEqual([]);
}

async function expectSynced(draftId: string, text: string) {
  expect(world.server.draft(draftId)?.body).toBe(text);
  const local = await localOf(draftId);
  expect(local?.status).toBe('synced');
  expect(local?.acknowledgedRevision).toBe(local?.revision);
  expect(world.queue.entries).toHaveLength(0);
}

describe('composing a draft', () => {
  it('saves what was typed without saying anything', async () => {
    const composer = world.page.compose();
    composer.type('Hello');
    await world.advance(2_000);

    await expectSynced(composer.draftId()!, 'Hello');
    expectQuiet();
  });

  it('keeps up with fast typing and ends on the last keystroke', async () => {
    const composer = world.page.compose();
    for (let length = 1; length <= 40; length++) {
      composer.type(
        'The quick brown fox jumps over the lazy dog'.slice(0, length)
      );
      await world.advance(120);
    }
    await world.advance(3_000);

    await expectSynced(
      composer.draftId()!,
      'The quick brown fox jumps over the lazy dog'.slice(0, 40)
    );
    expectQuiet();
  });

  it('keeps typing through a server that takes seconds to answer', async () => {
    world.server.state.latencyMs = 4_000;
    const composer = world.page.compose();
    composer.type('First');
    await world.advance(1_000);
    composer.type('First, then more');
    await world.advance(1_000);
    composer.type('First, then more, then the rest');
    await world.advance(20_000);

    await expectSynced(composer.draftId()!, 'First, then more, then the rest');
    expectQuiet();
  });

  it.each<[string, Fault, number]>([
    ['a dropped connection', { kind: 'network' }, 3],
    ['an unavailable server', { kind: 'http', status: 503 }, 3],
    ['a save whose answer was lost', { kind: 'lost' }, 2],
    ['a server fault', { kind: 'graphql', code: 'INTERNAL' }, 2],
    [
      'a server fault after the save was stored',
      { kind: 'graphql', code: 'INTERNAL', applied: true },
      2,
    ],
  ])('rides out %s without telling the user', async (_name, fault, times) => {
    world.server.state.fault = failing('SaveEmailDraft', fault, times);
    const composer = world.page.compose();
    composer.type('Survives');
    await world.advance(30_000);

    await expectSynced(composer.draftId()!, 'Survives');
    expect(
      world.server.requests.filter(
        (request) => request.operation === 'SaveEmailDraft'
      )
    ).toHaveLength(times + 1);
    expectQuiet();
  });

  it('rides out a server that is unavailable and then faults', async () => {
    world.server.state.fault = (request) => {
      if (request.operation !== 'SaveEmailDraft') return;
      if (request.nth <= 3) return { kind: 'http', status: 503 };
      if (request.nth <= 5) return { kind: 'graphql', code: 'INTERNAL' };
    };
    const composer = world.page.compose();
    composer.type('Flapping server');
    await world.advance(60_000);

    await expectSynced(composer.draftId()!, 'Flapping server');
    expectQuiet();
  });

  it('rides out slow device storage while the queue admits the save', async () => {
    const composer = world.page.compose();
    world.localStallMs = 2_500;
    composer.type('Slow disk');
    await world.advance(3_000);
    world.localStallMs = 0;
    await world.advance(10_000);

    await expectSynced(composer.draftId()!, 'Slow disk');
    expectQuiet();
  });

  it('reports a server that keeps faulting, and Retry recovers the draft', async () => {
    world.server.state.fault = failing(
      'SaveEmailDraft',
      { kind: 'graphql', code: 'INTERNAL' },
      3
    );
    const composer = world.page.compose();
    composer.type('Needs a retry');
    await world.advance(30_000);

    const draftId = composer.draftId()!;
    expect((await localOf(draftId))?.status).toBe('failed');
    expect(composer.banner()).toMatchObject({
      message: 'Draft could not be synced',
      failed: true,
      action: 'retry',
    });
    expect(
      world.failures().filter((event) => event.kind === 'sync-failed')
    ).toHaveLength(1);

    composer.retry();
    await world.advance(5_000);
    await expectSynced(draftId, 'Needs a retry');
    expect(composer.banner()).toBeUndefined();
  });

  it('stops resubmitting a save the server refused, and keeps the text', async () => {
    world.server.state.fault = failing(
      'SaveEmailDraft',
      { kind: 'graphql', code: 'INVALID' },
      1
    );
    const composer = world.page.compose();
    composer.type('Refused');
    await world.advance(3_000);
    composer.type('Refused, but still typing');
    await world.advance(10_000);

    const draftId = composer.draftId()!;
    const local = await localOf(draftId);
    expect(local?.status).toBe('failed');
    expect(local?.content.body_text).toBe('Refused, but still typing');
    expect(
      world.server.requests.filter(
        (request) => request.operation === 'SaveEmailDraft'
      )
    ).toHaveLength(1);
    expect(composer.banner()).toMatchObject({ failed: true, action: 'retry' });

    composer.retry();
    await world.advance(5_000);
    await expectSynced(draftId, 'Refused, but still typing');
    expect(composer.banner()).toBeUndefined();
  });

  it('shows only the quiet waiting notice while offline, then catches up', async () => {
    world.offline = true;
    world.server.state.fault = () => ({ kind: 'network' });
    const composer = world.page.compose();
    composer.type('Written on a plane');
    await world.advance(20_000);

    expect(composer.banner()).toMatchObject({
      message: 'Saved on this device; waiting to sync',
      failed: false,
    });
    expect(world.failures()).toEqual([]);

    world.offline = false;
    world.server.state.fault = undefined;
    await world.advance(90_000);
    await expectSynced(composer.draftId()!, 'Written on a plane');
    expect(composer.banner()).toBeUndefined();
    expectQuiet();
  });
});

describe('discarding a draft', () => {
  const requestsFor = (operation: string) =>
    world.server.requests.filter((request) => request.operation === operation);

  async function expectDiscarded(draftId: string) {
    expect(world.server.draft(draftId)).toBeUndefined();
    expect(await localOf(draftId)).toBeUndefined();
    expect(world.queue.entries).toHaveLength(0);
  }

  it('deletes a saved draft and says nothing, however long the server takes', async () => {
    const composer = world.page.compose();
    composer.type('Not needed');
    await world.advance(2_000);
    const draftId = composer.draftId()!;
    expect(world.server.draft(draftId)).toBeDefined();

    world.server.state.latencyMs = 8_000;
    const discarded = composer.discard();
    // Sampled while the delete is on the wire: the old false alarm fired here.
    for (let waited = 0; waited < 7_000; waited += 250) {
      await world.advance(250);
      expect(world.failures()).toEqual([]);
    }
    await world.settle(discarded);
    await world.advance(2_000);

    await expectDiscarded(draftId);
    expectQuiet();
  });

  it('never creates a draft that was discarded before its first save', async () => {
    const composer = world.page.compose();
    composer.type('Changed my mind');
    await world.advance(100);
    const draftId = composer.draftId()!;
    await world.settle(composer.discard());
    await world.advance(10_000);

    await expectDiscarded(draftId);
    expect(requestsFor('SaveEmailDraft')).toHaveLength(0);
    expectQuiet();
  });

  it('leaves nothing behind when the discard overtakes a save on the wire', async () => {
    world.server.state.latencyMs = 3_000;
    const composer = world.page.compose();
    composer.type('Saving as I discard');
    await world.advance(1_000);
    const draftId = composer.draftId()!;
    expect(requestsFor('SaveEmailDraft')).toHaveLength(1);

    await world.settle(composer.discard());
    await world.advance(20_000);

    await expectDiscarded(draftId);
    expectQuiet();
  });

  it.each<[string, Fault, number]>([
    ['a dropped connection', { kind: 'network' }, 3],
    ['an unavailable server', { kind: 'http', status: 503 }, 2],
    ['a delete whose answer was lost', { kind: 'lost' }, 1],
    ['a server fault', { kind: 'graphql', code: 'INTERNAL' }, 2],
  ])('rides out %s without telling the user', async (_name, fault, times) => {
    const composer = world.page.compose();
    composer.type('Not needed');
    await world.advance(2_000);
    const draftId = composer.draftId()!;

    world.server.state.fault = failing('DeleteEmailDraft', fault, times);
    await world.settle(composer.discard());
    await world.advance(30_000);

    await expectDiscarded(draftId);
    expectQuiet();
  });

  it('deletes after reconnecting when the draft was discarded offline', async () => {
    const composer = world.page.compose();
    composer.type('Not needed');
    await world.advance(2_000);
    const draftId = composer.draftId()!;

    world.offline = true;
    world.server.state.fault = () => ({ kind: 'network' });
    await world.settle(composer.discard());
    await world.advance(30_000);
    expect(world.server.draft(draftId)).toBeDefined();
    expect(world.failures()).toEqual([]);

    world.offline = false;
    world.server.state.fault = undefined;
    await world.advance(90_000);
    await expectDiscarded(draftId);
    expectQuiet();
  });

  it('finishes a discard that a reload interrupted', async () => {
    const composer = world.page.compose();
    composer.type('Not needed');
    await world.advance(2_000);
    const draftId = composer.draftId()!;

    world.server.state.latencyMs = 5_000;
    world.abandon(composer.discard());
    await world.advance(500);
    world.server.state.latencyMs = 20;
    await world.reload();
    // The old page's request holds the queue's lease until it expires.
    await world.advance(QUEUE_LEASE_MS + 60_000);

    await expectDiscarded(draftId);
    expectQuiet();
  });

  it('offers Retry discard when the server refuses, and the retry deletes it', async () => {
    const composer = world.page.compose();
    composer.type('Not needed');
    await world.advance(2_000);
    const draftId = composer.draftId()!;

    world.server.state.fault = failing(
      'DeleteEmailDraft',
      { kind: 'graphql', code: 'INVALID' },
      1
    );
    await expect(world.settle(composer.discard())).rejects.toThrow();
    await world.advance(2_000);

    expect((await localOf(draftId))?.status).toBe('delete-failed');
    expect(composer.banner()).toMatchObject({
      failed: true,
      action: 'retry-discard',
    });

    composer.retry();
    await world.advance(5_000);
    await expectDiscarded(draftId);
  });

  it('starts a fresh draft when the user types again after discarding', async () => {
    const composer = world.page.compose();
    composer.type('First attempt');
    await world.advance(2_000);
    const first = composer.draftId()!;
    await world.settle(composer.discard());

    composer.type('Second attempt');
    await world.advance(3_000);
    const second = composer.draftId()!;

    expect(second).not.toBe(first);
    await expectSynced(second, 'Second attempt');
    expect(world.server.draft(first)).toBeUndefined();
    expect(world.server.drafts()).toHaveLength(1);
    expectQuiet();
  });
});

describe('reloading the page', () => {
  it('keeps text typed moments before the reload and syncs it once reopened', async () => {
    const composer = world.page.compose();
    composer.type('Typed just before the reload');
    await world.advance(100);
    const draftId = composer.draftId()!;
    expect(world.server.draft(draftId)).toBeUndefined();

    const page = await world.reload();
    const reopened = await world.settle(page.reopen(draftId));
    expect(reopened.text()).toBe('Typed just before the reload');
    reopened.type('Typed just before the reload, and after');
    await world.advance(5_000);

    await expectSynced(draftId, 'Typed just before the reload, and after');
    expectQuiet();
  });

  it('finishes a save that the reload interrupted, then syncs newer edits', async () => {
    world.server.state.latencyMs = 5_000;
    const composer = world.page.compose();
    composer.type('On the wire during the reload');
    await world.advance(1_000);
    const draftId = composer.draftId()!;

    world.server.state.latencyMs = 20;
    const page = await world.reload();
    const reopened = await world.settle(page.reopen(draftId));
    reopened.type('On the wire during the reload, then edited');
    await world.advance(QUEUE_LEASE_MS + 60_000);

    await expectSynced(draftId, 'On the wire during the reload, then edited');
    expect(world.server.drafts()).toHaveLength(1);
    expectQuiet();
  });

  it('replays a save queued offline after the app restarts online', async () => {
    world.offline = true;
    world.server.state.fault = () => ({ kind: 'network' });
    const composer = world.page.compose();
    composer.type('Queued offline');
    await world.advance(5_000);
    const draftId = composer.draftId()!;

    world.offline = false;
    world.server.state.fault = undefined;
    await world.reload();
    await world.advance(QUEUE_LEASE_MS + 60_000);

    await expectSynced(draftId, 'Queued offline');
    expectQuiet();
  });
});

describe('sending', () => {
  const sent = () => world.server.delivered.map((message) => message.body);

  it('delivers the message once and leaves no draft behind', async () => {
    const composer = world.page.compose();
    composer.type('Ship it');
    await world.advance(2_000);
    const draftId = composer.draftId()!;

    await world.settle(composer.send());
    await world.advance(30_000);

    expect(sent()).toEqual(['Ship it']);
    expect(world.server.drafts()).toHaveLength(0);
    expect(await localOf(draftId)).toBeUndefined();
    expect(await world.page.sends.readEmailSendIntents()).toEqual([]);
    expectQuiet();
  });

  it('does not report a save that reaches the server after its own send', async () => {
    // The first save is dropped and its retry is slow, so the retry is still
    // on the wire when the send is accepted. The server then refuses it.
    world.server.state.fault = (request) => {
      if (request.operation !== 'SaveEmailDraft') return;
      if (request.nth === 1) return { kind: 'network' };
      if (request.nth === 2) return { kind: 'slow', ms: 3_000 };
    };
    const composer = world.page.compose();
    composer.type('Typed and sent at once');
    await world.advance(2_000);
    const draftId = composer.draftId()!;
    await world.settle(composer.send());
    await world.advance(60_000);

    expect(sent()).toEqual(['Typed and sent at once']);
    expect(
      world.server.requests.filter(
        (request) => request.operation === 'SaveEmailDraft'
      )
    ).toHaveLength(2);
    expect(world.server.drafts()).toHaveLength(0);
    expect(await localOf(draftId)).toBeUndefined();
    expect(world.queue.entries).toHaveLength(0);
    expectQuiet();
  });

  it('drops a queued save once its draft has been sent', async () => {
    world.offline = true;
    world.server.state.fault = (request) =>
      request.operation === 'SaveEmailDraft' ? { kind: 'network' } : undefined;
    const composer = world.page.compose();
    composer.type('Saved offline, then sent');
    await world.advance(3_000);
    const draftId = composer.draftId()!;
    await world.settle(composer.send());
    world.offline = false;
    world.server.state.fault = undefined;
    await world.advance(120_000);

    expect(sent()).toEqual(['Saved offline, then sent']);
    expect(world.server.drafts()).toHaveLength(0);
    expect(await localOf(draftId)).toBeUndefined();
    expect(world.queue.entries).toHaveLength(0);
    expectQuiet();
  });

  it('sends a message that was never saved as a draft', async () => {
    const composer = world.page.compose();
    composer.type('Straight to send');
    await world.advance(50);
    await world.settle(composer.send());
    await world.advance(60_000);

    expect(sent()).toEqual(['Straight to send']);
    expect(world.server.drafts()).toHaveLength(0);
    expect(world.queue.entries).toHaveLength(0);
    expectQuiet();
  });

  it.each<[string, Fault, number]>([
    ['a dropped connection', { kind: 'network' }, 3],
    ['an unavailable server', { kind: 'http', status: 503 }, 2],
    ['an acceptance whose answer was lost', { kind: 'lost' }, 1],
  ])('delivers exactly once through %s', async (_name, fault, times) => {
    const composer = world.page.compose();
    composer.type('Exactly once');
    await world.advance(2_000);

    world.server.state.fault = failing('SendEmailMessage', fault, times);
    await world.settle(composer.send());
    await world.advance(120_000);

    expect(sent()).toEqual(['Exactly once']);
    expect(world.server.drafts()).toHaveLength(0);
    expectQuiet();
  });

  it('delivers a message sent offline once the connection returns', async () => {
    const composer = world.page.compose();
    composer.type('Sent from a tunnel');
    await world.advance(2_000);

    world.offline = true;
    world.server.state.fault = () => ({ kind: 'network' });
    await world.settle(composer.send());
    await world.advance(30_000);
    expect(sent()).toEqual([]);

    world.offline = false;
    world.server.state.fault = undefined;
    await world.advance(120_000);
    expect(sent()).toEqual(['Sent from a tunnel']);
    expectQuiet();
  });

  it('delivers once when the page reloads right after Send', async () => {
    const composer = world.page.compose();
    composer.type('Sent, then reloaded');
    await world.advance(2_000);

    await world.settle(composer.send());
    await world.reload();
    await world.advance(120_000);

    expect(sent()).toEqual(['Sent, then reloaded']);
    expect(world.server.drafts()).toHaveLength(0);
    expectQuiet();
  });

  it('restores the draft on Undo and saves further edits', async () => {
    world.server.state.deliveryMs = 10_000;
    const composer = world.page.compose();
    composer.type('Sent too soon');
    await world.advance(2_000);

    const { attemptId, draftId } = await world.settle(composer.send());
    await world.advance(1_000);
    await world.settle(world.page.undo(attemptId));
    await world.advance(15_000);
    expect(sent()).toEqual([]);

    const reopened = await world.settle(world.page.reopen(draftId));
    expect(reopened.text()).toBe('Sent too soon');
    reopened.type('Sent too soon, now fixed');
    await world.advance(5_000);

    await expectSynced(reopened.draftId()!, 'Sent too soon, now fixed');
    expectQuiet();
  });

  it('holds a reply to a message still being delivered, then delivers both in order', async () => {
    world.server.state.deliveryMs = 8_000;
    const first = world.page.compose();
    first.type('First message');
    await world.advance(2_000);
    const original = await world.settle(first.send());
    await world.advance(1_000);

    // The sent message shows in the thread at once; the user replies to it.
    const serverId = world.server.row(original.draftId)!;
    const reply = world.page.compose({
      reply: { messageId: serverId.id, threadId: serverId.threadId },
    });
    reply.type('Following up');
    await world.advance(2_000);
    await world.settle(reply.send());
    await world.advance(60_000);

    expect(sent()).toEqual(['First message', 'Following up']);
    expect(world.server.drafts()).toHaveLength(0);
    expectQuiet();
  });

  it('saves a reply draft once the message it answers is delivered', async () => {
    world.server.state.deliveryMs = 8_000;
    const first = world.page.compose();
    first.type('First message');
    await world.advance(2_000);
    const original = await world.settle(first.send());
    await world.advance(1_000);

    const serverId = world.server.row(original.draftId)!;
    const reply = world.page.compose({
      reply: { messageId: serverId.id, threadId: serverId.threadId },
    });
    reply.type('A reply I keep as a draft');
    await world.advance(3_000);
    // Refused if sent now: the server still holds the first message as a draft.
    expect(world.server.draft(reply.draftId()!)).toBeUndefined();

    await world.advance(30_000);
    await expectSynced(reply.draftId()!, 'A reply I keep as a draft');
    expectQuiet();
  });
});
