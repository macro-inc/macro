import { expect, test } from 'bun:test';
import type { Woke } from '../../../core/agent.ts';
import { behavior } from '../../../core/behavior.ts';
import { type Catalog, module } from '../../../core/capability.ts';
import { simple } from '../../../runtimes/simple.ts';
import { scripts } from '../../../runtimes/test/scripts.ts';
import {
  type Failures,
  type Greeter,
  greet,
  greeting,
  greetingRequest,
  mostFailures,
  parseGreeting,
  said,
  unsayable,
} from '../index.ts';

const prompt = `<!-- for the people who edit this file -->
Write a hello.

## Have: computer

A computer of your own.

## Have: calls

Calls: you can join one and talk.
`;

const catalog: Catalog = {
  chat: module({
    name: 'chat',
    summary: 'chat',
    file: import.meta.path,
    functions: { dmOwner: async () => undefined, react: async () => undefined },
  }),
};

test('a prompt is its instructions and one section per thing an agent may have', () => {
  expect(parseGreeting(prompt)).toEqual({
    instructions: 'Write a hello.',
    haves: {
      computer: 'A computer of your own.',
      calls: 'Calls: you can join one and talk.',
    },
  });
});

test('the request has only what the agent has, and who is who', () => {
  const request = greetingRequest(parseGreeting(prompt), {
    have: ['calls'],
    ownerName: 'Maya',
    identity: undefined,
  });
  expect(request).toContain('Calls: you can join one and talk.');
  expect(request).not.toContain('A computer of your own.');
  expect(request).toContain('Maya');
  expect(request).toContain("You don't know yet");
  const known = greetingRequest(parseGreeting(prompt), {
    have: [],
    ownerName: undefined,
    identity: 'I am Pip.',
  });
  expect(known).toContain('I am Pip.');
  expect(known).toContain('greet them without one');
});

test('the unsayable words are the machinery and the catalog function names, not ordinary words', () => {
  const words = unsayable(catalog);
  expect(words).toContain('RunCapabilityScript');
  expect(words).toContain('dmOwner');
  expect(words).not.toContain('react');
  expect(words).not.toContain('ExecuteCode');
  expect(unsayable(catalog, ['ExecuteCode'])).toContain('ExecuteCode');
  expect(said('I can React to things.', words)).toEqual([]);
  expect(said('I use dmowner and code mode.', words)).toEqual([
    'code mode',
    'dmOwner',
  ]);
});

type Fake = {
  readonly answers?: string[];
  readonly greetedAlready?: boolean;
  /** Messages in the DM, read each time the greeting checks it. */
  readonly messages?: () => number;
  readonly failAsk?: boolean;
  readonly failures?: Failures;
  /** How many times opening the DM fails before it works. */
  readonly dmFailures?: number;
  /** Called as the model is asked, before it answers. */
  readonly onAsk?: () => void;
};

const hello =
  "Hi Maya, I just came online. I don't have a name yet.\n\nWhat can I help with first?";

const fakeGreeter = ({
  answers = [],
  greetedAlready = false,
  messages = () => 0,
  failAsk = false,
  failures = { paid: 0, unpaid: 0 },
  dmFailures = 0,
  onAsk = () => {},
}: Fake) => {
  /** What happened, in order: the model's life, the DM's, the facts'. */
  const events: string[] = [];
  const slept: number[] = [];
  let dmFailing = dmFailures;
  const asked: string[] = [];
  const sent: [string, string][] = [];
  const typing: string[] = [];
  const spans: Record<string, string | number | boolean> = {};
  const traced: string[] = [];
  let marked = greetedAlready;
  let failed: Failures = failures;
  const greeter: Greeter = {
    prompt: async () => prompt,
    have: async () => ['computer', 'calls', 'chat'],
    unsayable: unsayable(catalog),
    model: () => {
      events.push('model started');
      return {
        answer: async (request) => {
          events.push('model asked');
          asked.push(request);
          onAsk();
          if (failAsk) throw new Error('the model is down');
          const answer = answers.shift();
          if (answer === undefined) throw new Error('no more answers');
          return answer;
        },
        cancel: () => {
          events.push('model cancelled');
        },
      };
    },
    ownerName: async () => {
      events.push('owner name');
      return 'Maya';
    },
    ownerDm: async () => {
      events.push('dm opened');
      if (dmFailing > 0) {
        dmFailing -= 1;
        throw new Error('Macro is unreachable');
      }
      return 'dm-1';
    },
    hasMessages: async () => {
      events.push('dm checked');
      return messages() > 0;
    },
    send: async (channelId, text) => {
      sent.push([channelId, text]);
      return { messageId: 'm-1' };
    },
    startTyping: (channelId) => {
      events.push('typing');
      typing.push(`start ${channelId}`);
      return async () => {
        typing.push(`stop ${channelId}`);
      };
    },
    identity: async () => undefined,
    greeted: async () => marked,
    markGreeted: async () => {
      marked = true;
    },
    failures: async () => failed,
    recordFailure: async (kind) => {
      failed = { ...failed, [kind]: failed[kind] + 1 };
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    trace: (name, run) => {
      traced.push(name);
      return run({
        set: (key, value) => {
          spans[key] = value;
        },
      });
    },
    sinceStartMs: () => 2_400,
  };
  return {
    greeter,
    events,
    asked,
    sent,
    typing,
    spans,
    traced,
    slept,
    marked: () => marked,
    failed: () => failed,
  };
};

test('a new agent greets its owner in their DM, typing while it writes, and is marked greeted', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  expect(await greet(fake.greeter)).toEqual({
    kind: 'posted',
    channelId: 'dm-1',
    messageId: 'm-1',
    text: hello,
  });
  expect(fake.sent).toEqual([['dm-1', hello]]);
  expect(fake.typing.at(-1)).toBe('stop dm-1');
  expect(fake.slept).toEqual([]);
  expect(fake.marked()).toBe(true);
  expect(fake.asked[0]).toContain('A computer of your own.');
  expect(fake.traced).toEqual([
    'agent.greeting',
    'agent.greeting.write',
    'agent.greeting.post',
  ]);
  expect(fake.spans).toMatchObject({
    'agent.greeting.since_start_ms': 2_400,
    'agent.greeting.attempts': 1,
    'agent.greeting.outcome': 'posted',
    'agent.greeting.channel_id': 'dm-1',
    'agent.greeting.message_id': 'm-1',
    'agent.greeting.owner_named': true,
  });
});

test('an agent that has greeted never greets again', async () => {
  const fake = fakeGreeter({ answers: [hello], greetedAlready: true });
  expect(await greet(fake.greeter)).toEqual({ kind: 'already' });
  expect(fake.asked).toEqual([]);
  expect(fake.sent).toEqual([]);
});

test('a DM that already has messages is past the hello: nothing is written, and it is marked done', async () => {
  const fake = fakeGreeter({ answers: [hello], messages: () => 1 });
  expect(await greet(fake.greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.asked).toEqual([]);
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(true);
  expect(fake.spans['agent.greeting.outcome']).toBe('conversation_started');
});

test('an owner who writes while the greeting is written gets a reply, not a late hello', async () => {
  let messages = 0;
  const fake = fakeGreeter({
    answers: [hello],
    messages: () => messages,
    onAsk: () => {
      messages = 1;
    },
  });
  expect(await greet(fake.greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(true);
  expect(fake.typing.at(-1)).toBe('stop dm-1');
});

test('a draft that names its machinery is written again, and never posted', async () => {
  const leaky =
    'Hi Maya! I can do anything with RunCapabilityScript and dmOwner.';
  const fake = fakeGreeter({ answers: [leaky, hello] });
  expect(await greet(fake.greeter)).toMatchObject({
    kind: 'posted',
    text: hello,
  });
  expect(fake.asked).toHaveLength(2);
  expect(fake.asked[1]).toContain('RunCapabilityScript, dmOwner');
  expect(fake.sent).toEqual([['dm-1', hello]]);
  expect(fake.spans['agent.greeting.attempts']).toBe(2);
  expect(fake.spans['agent.greeting.rejected_words']).toBe(
    'RunCapabilityScript,dmOwner'
  );
});

test('a greeting that keeps naming its machinery fails unposted and unmarked, and is counted', async () => {
  const leaky = 'Hi Maya, I run in code mode.';
  const fake = fakeGreeter({ answers: [leaky, leaky] });
  await expect(greet(fake.greeter)).rejects.toThrow(
    'kept naming how the agent is built'
  );
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(false);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
  expect(fake.typing.at(-1)).toBe('stop dm-1');
  expect(fake.spans['agent.greeting.outcome']).toBe('failed');
  expect(fake.spans['agent.greeting.since_start_ms']).toBeUndefined();
  expect(fake.spans['agent.greeting.ended_since_start_ms']).toBe(2_400);
});

test('an answer that comes back empty was paid for: counted, not retried within the start', async () => {
  const fake = fakeGreeter({ answers: ['   ', hello] });
  await expect(greet(fake.greeter)).rejects.toThrow('came back empty');
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(false);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
  expect(fake.slept).toEqual([]);
});

test('a failure before the model answers is tried again within the start, with a wait', async () => {
  const fake = fakeGreeter({ answers: [hello], dmFailures: 1 });
  expect(await greet(fake.greeter)).toMatchObject({ kind: 'posted' });
  expect(fake.slept).toEqual([1_000]);
  expect(fake.spans['agent.greeting.retries']).toBe(1);
  expect(fake.failed()).toEqual({ paid: 0, unpaid: 0 });
});

test('a model call that fails was asked, so may have been charged: counted as paid, not retried', async () => {
  const fake = fakeGreeter({ failAsk: true });
  await expect(greet(fake.greeter)).rejects.toThrow('the model is down');
  expect(fake.asked).toHaveLength(1);
  expect(fake.slept).toEqual([]);
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(false);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
  expect(fake.typing.at(-1)).toBe('stop dm-1');
  expect(fake.spans['agent.greeting.outcome']).toBe('failed');
});

test('Macro that stays unreachable fails the start after its waits, counted as unpaid', async () => {
  const fake = fakeGreeter({ answers: [hello], dmFailures: 3 });
  await expect(greet(fake.greeter)).rejects.toThrow('Macro is unreachable');
  expect(fake.asked).toEqual([]);
  expect(fake.slept).toEqual([1_000, 5_000]);
  expect(fake.failed()).toEqual({ paid: 0, unpaid: 1 });
});

test('after enough failed starts of either kind the agent stops trying, without spending', async () => {
  for (const failures of [
    { paid: mostFailures.paid, unpaid: 0 },
    { paid: 0, unpaid: mostFailures.unpaid },
  ]) {
    const fake = fakeGreeter({ answers: [hello], failures });
    expect(await greet(fake.greeter)).toEqual({ kind: 'gave_up', failures });
    expect(fake.asked).toEqual([]);
    expect(fake.sent).toEqual([]);
    expect(fake.marked()).toBe(true);
    expect(fake.spans['agent.greeting.outcome']).toBe('gave_up');
  }
});

test('as a behavior, it greets once when the agent starts', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  await behavior()
    .decorate({
      agent: {
        wake: async (): Promise<Woke> => ({ kind: 'done', reply: 'ok' }),
      },
    })
    .use(greeting(() => fake.greeter))
    .on(
      (sources) => sources.hooks.failed,
      async (failure) => {
        throw new Error(`unexpected failure: ${failure.error}`);
      }
    )
    .run(simple({ systemPrompt: '', ...scripts() }));
  expect(fake.sent).toEqual([['dm-1', hello]]);
});

test('as a behavior, it greets inside what the agent wraps it in', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  const order: string[] = [];
  await behavior()
    .decorate({
      agent: {
        wake: async (): Promise<Woke> => ({ kind: 'done', reply: 'ok' }),
      },
    })
    .use(
      greeting(() => fake.greeter, {
        around: () => async (run) => {
          order.push('enter');
          const value = await run();
          order.push('leave');
          return value;
        },
        done: () => async (greeted) => {
          order.push(greeted.kind);
        },
      })
    )
    .on(
      (sources) => sources.hooks.failed,
      async (failure) => {
        throw new Error(`unexpected failure: ${failure.error}`);
      }
    )
    .run(simple({ systemPrompt: '', ...scripts() }));
  expect(order).toEqual(['enter', 'leave', 'posted']);
  expect(fake.sent).toEqual([['dm-1', hello]]);
});

test('the model warms up and the facts are read while the DM is still opening', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let openDm: (dm: string) => void = () => {};
  const dmOpening = new Promise<string>((resolve) => {
    openDm = resolve;
  });
  let nameAsked: () => void = () => {};
  const nameWasAsked = new Promise<void>((resolve) => {
    nameAsked = resolve;
  });
  const greeter: Greeter = {
    ...fake.greeter,
    ownerDm: () => dmOpening,
    ownerName: async () => {
      nameAsked();
      return 'Maya';
    },
  };
  const greeting = greet(greeter);
  // The owner's name is asked for, and the model started, before the DM exists.
  await nameWasAsked;
  expect(fake.events).toContain('model started');
  expect(fake.events).not.toContain('dm checked');
  openDm('dm-1');
  expect(await greeting).toMatchObject({ kind: 'posted' });
});

test('typing starts as soon as the DM is known, before it is checked, and the model is asked only after', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  await greet(fake.greeter);
  const at = (event: string) => fake.events.indexOf(event);
  expect(at('model started')).toBe(0);
  const dmLane = fake.events.filter((event) =>
    ['dm opened', 'typing', 'dm checked'].includes(event)
  );
  expect(dmLane.slice(0, 3)).toEqual(['dm opened', 'typing', 'dm checked']);
  expect(at('model asked')).toBeGreaterThan(at('dm checked'));
  expect(at('model asked')).toBeGreaterThan(at('owner name'));
  expect(fake.events.at(-1)).toBe('model cancelled');
});

test('an owner who wrote first means the warmed model is dropped, never asked', async () => {
  const fake = fakeGreeter({ answers: [hello], messages: () => 1 });
  expect(await greet(fake.greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.events).toContain('model started');
  expect(fake.events).toContain('model cancelled');
  expect(fake.events).not.toContain('model asked');
  expect(fake.typing).toEqual(['start dm-1', 'stop dm-1']);
});

test('a DM that already has messages is done even when the facts fail to load', async () => {
  const fake = fakeGreeter({ answers: [hello], messages: () => 1 });
  const greeter: Greeter = {
    ...fake.greeter,
    prompt: async () => {
      throw new Error('the prompt file is gone');
    },
  };
  expect(await greet(greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.marked()).toBe(true);
  expect(fake.failed()).toEqual({ paid: 0, unpaid: 0 });
  expect(fake.slept).toEqual([]);
});
