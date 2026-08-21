import { describe, expect, it } from 'vitest';
import {
  type ComposerFacts,
  canStop,
  isBusy,
  nextAction,
  type QueuedPrompt,
} from './composer-state';

const prompt = (id: string): QueuedPrompt => ({ id, markdown: `p-${id}` });

const facts = (overrides: Partial<ComposerFacts>): ComposerFacts => ({
  post: { type: 'idle' },
  head: undefined,
  agentWorking: false,
  ...overrides,
});

describe('nextAction: when the head sends', () => {
  it('idle, agent idle, something queued → post the head', () => {
    const action = nextAction(facts({ head: prompt('a') }));
    expect(action).toEqual({ type: 'post_head', prompt: prompt('a') });
  });

  it('nothing queued → hold', () => {
    expect(nextAction(facts({})).type).toBe('hold');
  });
});

describe('nextAction: every hold, by priority', () => {
  it('a post on the wire holds, even with a head and an idle agent', () => {
    const action = nextAction(
      facts({ post: { type: 'posting', promptId: 'a' }, head: prompt('b') })
    );
    expect(action).toMatchObject({
      type: 'hold',
      reason: 'a post is on the wire',
    });
  });

  it('awaiting the turn holds — the drain must not fire into the same turn', () => {
    const action = nextAction(
      facts({
        post: { type: 'awaiting_turn', promptId: 'a' },
        head: prompt('b'),
      })
    );
    expect(action.type).toBe('hold');
  });

  it('a stop on the wire holds, even with a queued prompt', () => {
    const action = nextAction(
      facts({
        post: { type: 'stopping' },
        head: prompt('a'),
        agentWorking: true,
      })
    );
    expect(action).toMatchObject({
      type: 'hold',
      reason: 'a stop is on the wire',
    });
  });

  it('a failed head holds everything behind it — order is preserved', () => {
    const action = nextAction(
      facts({ post: { type: 'failed', promptId: 'a' }, head: prompt('a') })
    );
    expect(action.type).toBe('hold');
  });

  it('a running turn holds a queued prompt until it settles', () => {
    const action = nextAction(facts({ head: prompt('a'), agentWorking: true }));
    expect(action).toMatchObject({
      type: 'hold',
      reason: 'the agent is mid-turn',
    });
  });

  it('after a cancel, a queued prompt posts without waiting for the turn to drop', () => {
    const action = nextAction(
      facts({
        head: prompt('next'),
        agentWorking: true,
        replacing: true,
      })
    );
    expect(action).toEqual({ type: 'post_head', prompt: prompt('next') });
  });
});

describe('nextAction: the wedges the old machine allowed', () => {
  it('a prompt queued while idle sends — nothing waits for a turn_settled that will never come', () => {
    // Old bug: post_failed returned to idle with the prompt re-queued, but
    // only working+turn_settled ever flushed the queue.
    const action = nextAction(facts({ head: prompt('stranded') }));
    expect(action.type).toBe('post_head');
  });

  it('the decision is memoryless: the same facts always produce the same action', () => {
    const same = facts({ head: prompt('a') });
    expect(nextAction(same)).toEqual(nextAction(same));
  });
});

describe('isBusy', () => {
  it('working, posting, awaiting_turn, and stopping are busy', () => {
    expect(isBusy({ type: 'idle' }, true)).toBe(true);
    expect(isBusy({ type: 'posting', promptId: 'a' }, false)).toBe(true);
    expect(isBusy({ type: 'awaiting_turn', promptId: 'a' }, false)).toBe(true);
    expect(isBusy({ type: 'stopping' }, false)).toBe(true);
  });

  it('idle and failed are not — a failure hands the send button back', () => {
    expect(isBusy({ type: 'idle' }, false)).toBe(false);
    expect(isBusy({ type: 'failed', promptId: 'a' }, false)).toBe(false);
  });
});

describe('canStop', () => {
  it('allows a stop while a turn is running', () => {
    expect(canStop({ type: 'idle' }, true, false)).toBe(true);
  });

  it('rejects a second stop while one is in flight or replacing', () => {
    expect(canStop({ type: 'stopping' }, true, false)).toBe(false);
    expect(canStop({ type: 'idle' }, true, true)).toBe(false);
  });

  it('rejects a stop while idle', () => {
    expect(canStop({ type: 'idle' }, false, false)).toBe(false);
  });
});
