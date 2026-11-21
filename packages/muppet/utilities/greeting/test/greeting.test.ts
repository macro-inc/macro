import { expect, test } from 'bun:test';
import { codeTools } from '../../../agents/code-tools.ts';
import type { Woke } from '../../../core/agent.ts';
import { behavior } from '../../../core/behavior.ts';
import { type Catalog, module } from '../../../core/capability.ts';
import { simple } from '../../../runtimes/simple.ts';
import { scripts } from '../../../runtimes/test/scripts.ts';
import {
  type Failures,
  type Greeter,
  type GreetingChat,
  type GreetingClock,
  type GreetingStore,
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
  const words = unsayable(catalog, Object.values(codeTools));
  expect(words).toContain('RunCapabilityScript');
  // The library's list holds no agent's tool names: an agent passes its own.
  expect(unsayable(catalog)).not.toContain('RunCapabilityScript');
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

/** The greeter's ports, flat, so a test can replace one. */
type Flat = {
  readonly prompt: Greeter['prompt'];
  readonly have: Greeter['have'];
  readonly identity: Greeter['identity'];
  readonly unsayable: Greeter['unsayable'];
  readonly model: Greeter['model'];
  readonly ownerName: GreetingChat['ownerName'];
  readonly ownerDm: GreetingChat['ownerDm'];
  readonly hasMessages: GreetingChat['hasMessages'];
  readonly send: GreetingChat['send'];
  readonly startTyping: GreetingChat['startTyping'];
  readonly greeted: GreetingStore['greeted'];
  readonly markGreeted: GreetingStore['markGreeted'];
  readonly failures: GreetingStore['failures'];
  readonly recordFailure: GreetingStore['recordFailure'];
  readonly sleep: GreetingClock['sleep'];
  readonly after: GreetingClock['after'];
  readonly trace: Greeter['trace'];
  readonly sinceStartMs: GreetingClock['sinceStartMs'];
};

const grouped = (flat: Flat): Greeter => ({
  prompt: flat.prompt,
  have: flat.have,
  identity: flat.identity,
  unsayable: flat.unsayable,
  model: flat.model,
  chat: {
    ownerName: flat.ownerName,
    ownerDm: flat.ownerDm,
    hasMessages: flat.hasMessages,
    send: flat.send,
    startTyping: flat.startTyping,
  },
  store: {
    greeted: flat.greeted,
    markGreeted: flat.markGreeted,
    failures: flat.failures,
    recordFailure: flat.recordFailure,
  },
  clock: {
    sleep: flat.sleep,
    after: flat.after,
    sinceStartMs: flat.sinceStartMs,
  },
  trace: flat.trace,
});

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
  /** Each attempt's deadline: fired only when a test says so. */
  const deadlines: { readonly ms: number; readonly run: () => void }[] = [];
  /** Each traced step's promise, by name, so a test can wait for one to end. */
  const runs: { readonly name: string; readonly result: Promise<unknown> }[] =
    [];
  let cancelledDeadlines = 0;
  let dmFailing = dmFailures;
  const asked: string[] = [];
  const sent: [string, string][] = [];
  const typing: string[] = [];
  /** Each span's attributes, by the span's name: the last span of that name. */
  const spans = new Map<string, Record<string, string | number | boolean>>();
  const traced: string[] = [];
  let marked = greetedAlready;
  let failed: Failures = failures;
  const flat: Flat = {
    prompt: async () => prompt,
    have: async () => ['computer', 'calls', 'chat'],
    unsayable: unsayable(catalog, Object.values(codeTools)),
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
    after: (ms, run) => {
      let cancelled = false;
      // Firing a cancelled deadline does nothing, as a real timer wouldn't.
      deadlines.push({
        ms,
        run: () => {
          if (!cancelled) run();
        },
      });
      return () => {
        cancelled = true;
        cancelledDeadlines += 1;
      };
    },
    trace: (name, run) => {
      traced.push(name);
      const attributes: Record<string, string | number | boolean> = {};
      spans.set(name, attributes);
      const result = run({
        set: (key, value) => {
          attributes[key] = value;
        },
      });
      runs.push({ name, result });
      return result;
    },
    sinceStartMs: () => 2_400,
  };
  return {
    greeter: grouped(flat),
    flat,
    events,
    asked,
    sent,
    typing,
    /** The attributes of the last span named `name` (`agent.greeting` for the whole greeting). */
    span: (name = 'agent.greeting') => spans.get(name) ?? {},
    traced,
    slept,
    deadlines,
    runs,
    cancelledDeadlines: () => cancelledDeadlines,
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
  // Typing starts once and is stopped exactly once.
  expect(fake.typing).toEqual(['start dm-1', 'stop dm-1']);
  expect(fake.slept).toEqual([]);
  // The attempt had a deadline, taken off as it committed to the post.
  expect(fake.deadlines.map(({ ms }) => ms)).toEqual([90_000]);
  expect(fake.cancelledDeadlines()).toBeGreaterThanOrEqual(1);
  expect(fake.marked()).toBe(true);
  expect(fake.asked[0]).toContain('A computer of your own.');
  expect(fake.traced).toEqual([
    'agent.greeting',
    'agent.greeting.attempt',
    'agent.greeting.dm',
    'agent.greeting.facts',
    'agent.greeting.write',
    'agent.greeting.post',
  ]);
  // The whole greeting's span has its outcome; the attempt's, what it did.
  expect(fake.span()).toMatchObject({
    'agent.greeting.outcome': 'posted',
    'agent.greeting.ended_since_start_ms': 2_400,
  });
  expect(fake.span('agent.greeting.attempt')).toMatchObject({
    'agent.greeting.attempt': 1,
    'agent.greeting.since_start_ms': 2_400,
    'agent.greeting.drafts': 1,
    'agent.greeting.outcome': 'posted',
    'agent.greeting.channel_id': 'dm-1',
    'agent.greeting.message_id': 'm-1',
    'agent.greeting.owner_named': true,
  });
  expect(fake.span('agent.greeting.dm')).toEqual({
    'agent.greeting.dm_written': false,
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
  expect(fake.span()['agent.greeting.outcome']).toBe('conversation_started');
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
  expect(fake.span('agent.greeting.attempt')['agent.greeting.drafts']).toBe(2);
  expect(
    fake.span('agent.greeting.attempt')['agent.greeting.rejected_words']
  ).toBe('RunCapabilityScript,dmOwner');
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
  expect(fake.span()['agent.greeting.outcome']).toBe('failed');
  expect(
    fake.span('agent.greeting.attempt')['agent.greeting.since_start_ms']
  ).toBeUndefined();
  expect(fake.span()['agent.greeting.ended_since_start_ms']).toBe(2_400);
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
  expect(fake.span()['agent.greeting.retries']).toBe(1);
  // The model was asked once, so the start counted as paid then; no unpaid.
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
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
  expect(fake.span()['agent.greeting.outcome']).toBe('failed');
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
    expect(fake.span()['agent.greeting.outcome']).toBe('gave_up');
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
  const greeter: Greeter = grouped({
    ...fake.flat,
    ownerDm: () => dmOpening,
    ownerName: async () => {
      nameAsked();
      return 'Maya';
    },
  });
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
  const greeter: Greeter = grouped({
    ...fake.flat,
    prompt: async () => {
      throw new Error('the prompt file is gone');
    },
  });
  expect(await greet(greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.marked()).toBe(true);
  expect(fake.failed()).toEqual({ paid: 0, unpaid: 0 });
  expect(fake.slept).toEqual([]);
});

test('a typing stop that rejects is recorded, and the greeting still posts', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let stops = 0;
  const greeter: Greeter = grouped({
    ...fake.flat,
    startTyping: () => async () => {
      stops += 1;
      throw new Error('typing is down');
    },
  });
  expect(await greet(greeter)).toMatchObject({ kind: 'posted' });
  expect(stops).toBe(1);
  expect(
    fake.span('agent.greeting.attempt')['agent.greeting.typing_stop_failed']
  ).toBe(true);
});

test('facts that keep failing on an empty DM fail the start unpaid, after its waits', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  const greeter: Greeter = grouped({
    ...fake.flat,
    prompt: async () => {
      throw new Error('the prompt file is gone');
    },
  });
  await expect(greet(greeter)).rejects.toThrow('the prompt file is gone');
  expect(fake.asked).toEqual([]);
  expect(fake.slept).toEqual([1_000, 5_000]);
  expect(fake.failed()).toEqual({ paid: 0, unpaid: 1 });
});

test('a DM check that fails after the words were written fails the start paid, unposted', async () => {
  let checks = 0;
  const fake = fakeGreeter({ answers: [hello] });
  const greeter: Greeter = grouped({
    ...fake.flat,
    hasMessages: async () => {
      checks += 1;
      if (checks > 1) throw new Error('Macro is unreachable');
      return false;
    },
  });
  await expect(greet(greeter)).rejects.toThrow('Macro is unreachable');
  expect(fake.sent).toEqual([]);
  expect(fake.slept).toEqual([]);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
});

test('a greeting posted but not marked is not posted again: the next start sees the DM', async () => {
  let messages = 0;
  const fake = fakeGreeter({
    answers: [hello, hello],
    messages: () => messages,
  });
  const first: Greeter = grouped({
    ...fake.flat,
    send: async (channelId, text) => {
      const posted = await fake.flat.send(channelId, text);
      messages += 1;
      return posted;
    },
    markGreeted: async () => {
      throw new Error('the disk is full');
    },
  });
  await expect(greet(first)).rejects.toThrow('the disk is full');
  expect(fake.sent).toHaveLength(1);
  expect(await greet(fake.greeter)).toEqual({ kind: 'conversation_started' });
  expect(fake.sent).toHaveLength(1);
  expect(fake.marked()).toBe(true);
});

test('a start that dies while the model is asked is already counted as paid', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let asked: () => void = () => {};
  const wasAsked = new Promise<void>((resolve) => {
    asked = resolve;
  });
  const greeter: Greeter = grouped({
    ...fake.flat,
    model: () => ({
      answer: () => {
        asked();
        return new Promise<string>(() => {});
      },
      cancel: () => {},
    }),
  });
  void greet(greeter).catch(() => undefined);
  await wasAsked;
  // The process could be killed now: the start is on record.
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
});

test('an attempt past its deadline drops the model, stops typing, and never posts', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let cancelled = 0;
  let asked: () => void = () => {};
  const wasAsked = new Promise<void>((resolve) => {
    asked = resolve;
  });
  let answer: (text: string) => void = () => {};
  const greeter: Greeter = grouped({
    ...fake.flat,
    model: () => ({
      answer: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
          asked();
        }),
      cancel: () => {
        cancelled += 1;
      },
    }),
  });
  const greeting = greet(greeter);
  await wasAsked;
  fake.deadlines[0]?.run();
  await expect(greeting).rejects.toThrow('past its deadline');
  expect(cancelled).toBe(1);
  expect(fake.typing).toEqual(['start dm-1', 'stop dm-1']);
  expect(fake.span('agent.greeting.attempt')['agent.greeting.timed_out']).toBe(
    true
  );
  // Paid: the model had been asked. Not retried within the start.
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
  // The model answering late changes nothing: the write step ends, abandoned.
  answer(hello);
  const writing = fake.runs.find(({ name }) => name === 'agent.greeting.write');
  await expect(writing?.result).rejects.toThrow('past its deadline');
  expect(fake.sent).toEqual([]);
  expect(fake.marked()).toBe(false);
});

test('an attempt that hangs before the model is asked is tried again, and only the try that asks is counted', async () => {
  let checks = 0;
  const fake = fakeGreeter({ answers: [hello] });
  let checking: () => void = () => {};
  const firstCheck = new Promise<void>((resolve) => {
    checking = resolve;
  });
  const greeter: Greeter = grouped({
    ...fake.flat,
    hasMessages: async () => {
      checks += 1;
      if (checks === 1) {
        checking();
        return new Promise<boolean>(() => {});
      }
      return false;
    },
  });
  const greeting = greet(greeter);
  await firstCheck;
  fake.deadlines[0]?.run();
  expect(await greeting).toMatchObject({ kind: 'posted' });
  expect(fake.slept).toEqual([1_000]);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
});

test('a failure count that can not be written does not hide why the start failed', async () => {
  const fake = fakeGreeter({ dmFailures: 3 });
  const greeter: Greeter = grouped({
    ...fake.flat,
    recordFailure: async () => {
      throw new Error('the disk is full');
    },
  });
  await expect(greet(greeter)).rejects.toThrow('Macro is unreachable');
  expect(fake.span()['agent.greeting.failure_not_recorded']).toBe(true);
});

test('an agent with nothing to mention is told so, and empty words are never banned', () => {
  const request = greetingRequest(parseGreeting(prompt), {
    have: [],
    ownerName: 'Maya',
    identity: undefined,
  });
  expect(request).toContain('Nothing to mention yet');
  expect(unsayable(catalog, ['', '  '])).not.toContain('');
  expect(said('Hi Maya.', unsayable(catalog, ['']))).toEqual([]);
});

test('an attempt past its deadline while opening the DM never starts typing there', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let opens = 0;
  let openFirst: (dm: string) => void = () => {};
  let openingFirst: () => void = () => {};
  const firstOpening = new Promise<void>((resolve) => {
    openingFirst = resolve;
  });
  const greeter: Greeter = grouped({
    ...fake.flat,
    ownerDm: () => {
      opens += 1;
      if (opens === 1) {
        openingFirst();
        return new Promise<string>((resolve) => {
          openFirst = resolve;
        });
      }
      return fake.flat.ownerDm();
    },
  });
  const greeting = greet(greeter);
  await firstOpening;
  fake.deadlines[0]?.run();
  expect(await greeting).toMatchObject({ kind: 'posted' });
  // The first attempt's DM opens late: it must not start typing.
  openFirst('dm-1');
  const dmLane = fake.runs.find(({ name }) => name === 'agent.greeting.dm');
  await expect(dmLane?.result).rejects.toThrow('past its deadline');
  expect(fake.typing).toEqual(['start dm-1', 'stop dm-1']);
  expect(fake.slept).toEqual([1_000]);
});

test('a post in flight at the deadline is never abandoned: the hello is reported as posted', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let sending: () => void = () => {};
  const isSending = new Promise<void>((resolve) => {
    sending = resolve;
  });
  let land: () => void = () => {};
  const greeter: Greeter = grouped({
    ...fake.flat,
    send: async (channelId, text) => {
      sending();
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      return fake.flat.send(channelId, text);
    },
  });
  const greeting = greet(greeter);
  await isSending;
  // The deadline would fire now, but the attempt committed to its post.
  fake.deadlines[0]?.run();
  land();
  expect(await greeting).toMatchObject({ kind: 'posted', messageId: 'm-1' });
  expect(
    fake.span('agent.greeting.attempt')['agent.greeting.timed_out']
  ).toBeUndefined();
  expect(fake.marked()).toBe(true);
});

test('a paid count that can not be written is tried again before the model is asked', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let writes = 0;
  const greeter: Greeter = grouped({
    ...fake.flat,
    recordFailure: async (kind) => {
      writes += 1;
      if (writes === 1) throw new Error('the disk is busy');
      await fake.flat.recordFailure(kind);
    },
  });
  expect(await greet(greeter)).toMatchObject({ kind: 'posted' });
  // Not asked until the count was on record; asked once.
  expect(fake.asked).toHaveLength(1);
  expect(fake.slept).toEqual([1_000]);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
});

test('a paid count still being written when the deadline fires is written once, not twice', async () => {
  const fake = fakeGreeter({ answers: [hello] });
  let writes = 0;
  let land: () => void = () => {};
  let writing: () => void = () => {};
  const isWriting = new Promise<void>((resolve) => {
    writing = resolve;
  });
  const greeter: Greeter = grouped({
    ...fake.flat,
    recordFailure: async (kind) => {
      writes += 1;
      writing();
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      await fake.flat.recordFailure(kind);
    },
  });
  const greeting = greet(greeter);
  await isWriting;
  // The first attempt hangs on writing its count, past its deadline; the
  // retry waits on the same write instead of starting another.
  fake.deadlines[0]?.run();
  await fake.runs
    .find(({ name }) => name === 'agent.greeting.attempt')
    ?.result.catch(() => undefined);
  land();
  expect(await greeting).toMatchObject({ kind: 'posted' });
  expect(writes).toBe(1);
  expect(fake.failed()).toEqual({ paid: 1, unpaid: 0 });
});
