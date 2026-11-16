import { QUEUE_LEASE_MS } from '@graphql-cache/exchange/mutation-queue-runner';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import {
  type Composer,
  createDraftSyncWorld,
  type DraftSyncWorld,
  type ServerRequest,
} from './tests/draft-sync-world';

/**
 * Random sessions of typing, discarding, sending, undoing and reloading, under
 * faults that all pass by themselves: dropped connections, an unavailable
 * server, lost answers, slow answers, a couple of server faults per write and
 * slow device storage. Whatever the order, the user is never told a draft
 * failed, and once things settle the server holds exactly what they did.
 */

type Action =
  | { kind: 'type' | 'discard' | 'send' | 'undo' | 'reload' | 'reopen' }
  | { kind: 'wait'; ms: number }
  | { kind: 'switch' }
  | {
      kind: 'weather';
      weather:
        | 'clear'
        | 'offline'
        | 'unavailable'
        | 'lost'
        | 'faulting'
        | 'slow'
        | 'stalled';
    };

const action: fc.Arbitrary<Action> = fc.oneof(
  { weight: 10, arbitrary: fc.constant<Action>({ kind: 'type' }) },
  {
    weight: 8,
    arbitrary: fc
      .integer({ min: 20, max: 4_000 })
      .map<Action>((ms) => ({ kind: 'wait', ms })),
  },
  { weight: 2, arbitrary: fc.constant<Action>({ kind: 'discard' }) },
  { weight: 2, arbitrary: fc.constant<Action>({ kind: 'send' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'undo' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'reload' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'reopen' }) },
  { weight: 2, arbitrary: fc.constant<Action>({ kind: 'switch' }) },
  {
    weight: 4,
    arbitrary: fc
      .constantFrom(
        'clear',
        'offline',
        'unavailable',
        'lost',
        'faulting',
        'slow',
        'stalled'
      )
      .map<Action>((weather) => ({ kind: 'weather', weather })),
  }
);

type Slot = {
  composer?: Composer;
  /** The newest text the user typed into this slot's open draft. */
  text?: string;
};
type Sent = { attemptId: string; draftId: string; text: string };

type Weather = Extract<Action, { kind: 'weather' }>['weather'];

/** One user's session: what they did, and what the server should hold for it. */
function createSession(world: DraftSyncWorld) {
  const slots: Slot[] = [{}, {}];
  const discarded: string[] = [];
  const sent: Sent[] = [];
  const undone = new Set<string>();
  // Two server faults per write pass by themselves; a third is a real failure.
  const faults = new Map<string, number>();
  let typed = 0;
  let active = 0;
  let weather: Weather = 'clear';

  const open = (index: number) => {
    const slot = slots[index];
    slot.composer ??=
      index === 0
        ? world.page.compose()
        : world.page.compose({
            reply: { messageId: 'received-message', threadId: 'thread' },
          });
    return slot.composer;
  };
  const serverFault = (request: ServerRequest) => {
    const isDraftWrite =
      request.operation === 'SaveEmailDraft' ||
      request.operation === 'DeleteEmailDraft';
    if (!isDraftWrite) return;
    const key = `${request.operation}:${request.draftId}`;
    const seen = faults.get(key) ?? 0;
    if (seen >= 2) return;
    faults.set(key, seen + 1);
    return { kind: 'graphql' as const, code: 'INTERNAL' };
  };
  const setWeather = (next: Weather) => {
    weather = next;
    world.offline = next === 'offline';
    world.localStallMs = 0;
    world.server.state.latencyMs = next === 'slow' ? 2_500 : 20;
    world.server.state.fault = (request: ServerRequest) => {
      if (weather === 'offline') return { kind: 'network' };
      if (weather === 'unavailable') return { kind: 'http', status: 503 };
      if (weather === 'lost' && request.nth % 2 === 1) return { kind: 'lost' };
      if (weather === 'faulting') return serverFault(request);
    };
  };
  /** Whether Undo got there first; the server knows once the outbox settles. */
  const undoSend = async (attemptId: string) => {
    try {
      await world.settle(world.page.undo(attemptId));
      return true;
    } catch {
      // Too late, or the outbox is still confirming: it finishes either way.
      await world.advance(120_000);
      return !world.server.delivered.some(
        (message) => message.attemptId === attemptId
      );
    }
  };
  /** After a reload each draft reopens from whatever reached the disk. */
  const reopenAfterReload = async (index: number, draftId?: string) => {
    const slot = slots[index];
    slot.composer = undefined;
    slot.text = undefined;
    if (!draftId) return;
    // A keystroke the page never wrote down is gone with the page.
    const local = await world.settle(world.page.drafts.readLocalDraft(draftId));
    if (!local || local.status === 'deleting') return;
    slot.composer = await world.settle(world.page.reopen(draftId));
    slot.text = slot.composer.text();
  };

  const steps: Record<Action['kind'], (step: Action) => Promise<void>> = {
    async type() {
      const text = `text ${++typed}`;
      open(active).type(text);
      slots[active].text = text;
      await world.advance(30);
    },
    async wait(step) {
      if (step.kind === 'wait') await world.advance(step.ms);
    },
    async switch() {
      active = 1 - active;
    },
    async weather(step) {
      if (step.kind !== 'weather') return;
      setWeather(step.weather);
      if (step.weather !== 'stalled') return;
      // One slow spell of device storage, shorter than the retries allow.
      world.localStallMs = 2_500;
      await world.advance(1_500);
      world.localStallMs = 0;
    },
    async discard() {
      const slot = slots[active];
      const draftId = slot.composer?.draftId();
      if (!slot.composer || !draftId) return;
      await world.settle(slot.composer.discard());
      discarded.push(draftId);
      slot.text = undefined;
    },
    async send() {
      const slot = slots[active];
      if (!slot.composer?.draftId() || slot.text === undefined) return;
      sent.push(await world.settle(slot.composer.send()));
      slot.composer.close();
      slot.composer = undefined;
      slot.text = undefined;
    },
    async undo() {
      // Undo is offered right after Send, on a working connection.
      const last = sent.at(-1);
      if (!last || undone.has(last.attemptId) || weather !== 'clear') return;
      if (slots.some((other) => other.composer)) return;
      if (!(await undoSend(last.attemptId))) return;
      undone.add(last.attemptId);
      slots[0].composer = await world.settle(world.page.reopen(last.draftId));
      slots[0].text = last.text;
    },
    async reopen() {
      const slot = slots[active];
      const draftId = slot.composer?.draftId();
      if (!slot.composer || !draftId) return;
      // Let the keystroke reach the disk, as leaving a thread does.
      await world.advance(50);
      slot.composer.close();
      slot.composer = await world.settle(world.page.reopen(draftId));
    },
    async reload() {
      const open = slots.map((other) => other.composer?.draftId());
      await world.reload();
      for (const [index, draftId] of open.entries())
        await reopenAfterReload(index, draftId);
    },
  };
  setWeather('clear');

  return {
    async play(actions: Action[]) {
      for (const step of actions) await steps[step.kind](step);
    },
    /** The weather clears, and the user touches each open draft once more. */
    async finish() {
      setWeather('clear');
      await world.advance(QUEUE_LEASE_MS + 120_000);
      for (const slot of slots) {
        if (!slot.composer?.draftId() || slot.text === undefined) continue;
        slot.text = `final ${++typed}`;
        slot.composer.type(slot.text);
      }
      await world.advance(QUEUE_LEASE_MS + 120_000);
    },
    kept: () =>
      slots.flatMap((slot) => {
        const draftId = slot.composer?.draftId();
        return draftId && slot.text !== undefined
          ? [{ draftId, text: slot.text }]
          : [];
      }),
    discarded,
    delivered: () =>
      sent
        .filter(({ attemptId }) => !undone.has(attemptId))
        .map(({ attemptId, text }) => ({ attemptId, body: text })),
  };
}

async function run(world: DraftSyncWorld, actions: Action[]) {
  const session = createSession(world);
  await session.play(actions);
  await session.finish();

  expect(world.failures()).toEqual([]);
  expect(world.queue.entries).toEqual([]);
  expect(await world.page.sends.readEmailSendIntents()).toEqual([]);

  const kept = session.kept();
  for (const { draftId, text } of kept) {
    expect(world.server.draft(draftId)?.body).toBe(text);
    expect((await world.page.drafts.readLocalDraft(draftId))?.status).toBe(
      'synced'
    );
  }
  for (const draftId of session.discarded) {
    expect(world.server.draft(draftId)).toBeUndefined();
    expect(await world.page.drafts.readLocalDraft(draftId)).toBeUndefined();
  }
  // Each message once, with the text it was sent with. Unrelated messages may
  // go out in either order.
  const byAttempt = <Row extends { attemptId: string }>(rows: Row[]) =>
    [...rows].sort((a, b) => a.attemptId.localeCompare(b.attemptId));
  expect(
    byAttempt(
      world.server.delivered.map(({ attemptId, body }) => ({ attemptId, body }))
    )
  ).toEqual(byAttempt(session.delivered()));
  // Nothing resurrected, duplicated or left over.
  expect(world.server.drafts()).toHaveLength(kept.length);
}

it('never reports a failure and always converges under passing faults', {
  timeout: 600_000,
}, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(action, { minLength: 12, maxLength: 60 }),
      async (actions) => {
        const world = await createDraftSyncWorld();
        try {
          await run(world, actions);
        } finally {
          await world.dispose();
        }
      }
    ),
    {
      numRuns: Number(process.env.EMAIL_DRAFT_FUZZ_RUNS ?? 100),
      // A failure prints its seed and path; set both to replay just that session.
      seed: process.env.EMAIL_DRAFT_FUZZ_SEED
        ? Number(process.env.EMAIL_DRAFT_FUZZ_SEED)
        : undefined,
      path: process.env.EMAIL_DRAFT_FUZZ_PATH,
      endOnFailure: process.env.EMAIL_DRAFT_FUZZ_SHRINK !== '1',
    }
  );
});
