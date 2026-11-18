import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { Catalog } from '@macro-inc/muppet/core/capability';
import {
  type Greeter,
  greet,
  greetingRequest,
  parseGreeting,
  said,
} from '@macro-inc/muppet/utilities/greeting';
import { typingIndicators } from '@macro-inc/muppet/utilities/macro/chat';
import { passthrough } from '../../../agent/claude.ts';
import { capabilityModules } from '../../../index.ts';
import { typing as typingOf } from '../../chat/typing.ts';
import { computer, failuresFile, greetedFile } from '../config.ts';
import { greeterOf, greetingParent, vaultAnswers } from '../context.ts';

const markdown = await Bun.file(
  join(import.meta.dir, '..', 'greeting.md')
).text();

/** The starter agent's whole catalog, as `behavior/index.ts` lists it. */
const catalog: Catalog = Object.fromEntries(
  capabilityModules.map((module) => [module.name, module])
);
const everything = [...Object.keys(catalog), computer];

test('the greeting prompt never names how the agent is built', () => {
  // The words the agent's own wiring bans: the library's, its tools', its catalog's.
  const words = wiring(true).greeter.unsayable;
  expect(words).toContain('RunCapabilityScript');
  expect(words).toContain('ExecuteCode');
  expect(words).toContain('bin/agent');
  expect(words).toContain('dmOwner');
  expect(words).toContain('writeIdentity');
  expect(said(markdown, words)).toEqual([]);
  const request = greetingRequest(parseGreeting(markdown), {
    have: everything,
    ownerName: 'Maya',
    identity: undefined,
  });
  expect(said(request, words)).toEqual([]);
  expect(request.toLowerCase()).not.toContain('code mode');
  expect(request.toLowerCase()).not.toContain('script');
});

test('the prompt has a section for each thing the starter agent may have, and says only what it has', () => {
  const prompt = parseGreeting(markdown);
  expect(Object.keys(prompt.haves).sort()).toEqual(
    ['calls', 'chat', computer, 'secrets'].sort()
  );
  for (const name of Object.keys(prompt.haves))
    expect(everything).toContain(name);

  const all = greetingRequest(prompt, {
    have: everything,
    ownerName: 'Maya',
    identity: undefined,
  });
  expect(all).toContain('Linux machine');
  expect(all).toContain('approve it with a click');
  expect(all).toContain('without ever seeing the password');
  expect(all).toContain('join a Macro call');
  expect(all).toContain("anything else Macro's API can do");
  expect(all).toContain('mention each thing');

  const some = greetingRequest(prompt, {
    have: ['chat'],
    ownerName: 'Maya',
    identity: undefined,
  });
  expect(some).toContain('documents, channels');
  expect(some).not.toContain('password manager');
  expect(some).not.toContain('approve it with a click');
  expect(some).not.toContain('join a Macro call');
  expect(some).not.toContain('Linux machine');
});

const hello =
  "Hi Maya, I just came online. I don't have a name yet.\n\nWhat can I help with first?";

const wiring = (hosted: boolean, vault = true) => {
  // The prompt is where the wiring looks for it, beside the identity area's config.
  const files = new Map<string, string>([
    [join(import.meta.dir, '..', 'greeting.md'), markdown],
  ]);
  const now = Temporal.Instant.from('2026-01-05T10:00:00Z');
  const asks: unknown[] = [];
  const sent: string[] = [];
  const greeter = greeterOf({
    context: {
      clock: { now: () => now, sleep: async () => {} },
      join: (...parts: readonly string[]) => parts.join('/'),
      state: {
        memory: (owner: string) => `/state/memory/${owner}`,
        run: (owner: string) => `/state/run/${owner}`,
      },
      disk: {
        read: async (path: string) => files.get(path),
        write: async (path: string, text: string) => {
          files.set(path, text);
        },
        exists: async (path: string) => files.has(path),
      },
    },
    catalog,
    hosted,
    ask: async (_prompt, options) => {
      asks.push(options);
      return hello;
    },
    macro: {
      ownerName: async () => 'Maya',
      ownerDm: async () => 'dm-1',
      hasMessages: async () => false,
    },
    chat: {
      send: async (channelId, text) => {
        sent.push(text);
        return { channelId, messageId: 'm-1' };
      },
    },
    typing: { start: () => async () => {} },
    vaultOn: async () => vault,
    sleep: async () => {},
    after: () => () => {},
    trace: passthrough,
    sinceStartMs: () => 0,
  });
  return { greeter, files, asks, sent };
};

test('the wiring says the agent has a computer only when it runs on its own', async () => {
  expect(await wiring(true).greeter.have()).toContain(computer);
  expect(await wiring(false).greeter.have()).not.toContain(computer);
  expect(await wiring(false).greeter.have()).toContain('calls');
});

test('the wiring mentions the password manager only when the vault answers', async () => {
  expect(await wiring(true, true).greeter.have()).toContain('secrets');
  expect(await wiring(true, false).greeter.have()).not.toContain('secrets');
});

test("the wiring never lets a greeting name the agent's own command", () => {
  expect(wiring(true).greeter.unsayable).toContain('bin/agent');
});

test('the wiring reads the marker agents wrote when they introduced themselves, and writes the same one', async () => {
  const marker = `/state/memory/identity/${greetedFile}`;
  const old = wiring(true);
  old.files.set(marker, '2026-01-01T00:00:00Z\n');
  expect(await greet(old.greeter)).toEqual({ kind: 'already' });
  expect(old.sent).toEqual([]);

  const fresh = wiring(true);
  expect(await greet(fresh.greeter)).toMatchObject({ kind: 'posted' });
  expect(fresh.sent).toEqual([hello]);
  expect(fresh.files.has(marker)).toBe(true);
});

test('the wiring counts failed starts by kind in the run bucket', async () => {
  const { greeter, files } = wiring(true);
  const counter = `/state/run/identity/${failuresFile}`;
  expect(await greeter.store.failures()).toEqual({ paid: 0, unpaid: 0 });
  await greeter.store.recordFailure('paid');
  await greeter.store.recordFailure('unpaid');
  await greeter.store.recordFailure('unpaid');
  expect(files.get(counter)).toBe('{"paid":1,"unpaid":2}\n');
  expect(await greeter.store.failures()).toEqual({ paid: 1, unpaid: 2 });
  files.set(counter, '{"paid":"many"}\n');
  await expect(greeter.store.failures()).rejects.toThrow('malformed');
});

test('the wiring asks the quick model, with thinking off, and reads greeting.md', async () => {
  const { greeter, asks } = wiring(true);
  expect(await greeter.prompt()).toBe(markdown);
  await greeter.model().answer('hello');
  expect(asks).toEqual([
    { model: 'claude-haiku-4-5-20251001', timeoutMs: 60_000, thinking: false },
  ]);
});

test("the greeting's typing never stops a reply's typing in the same DM", async () => {
  const sentTyping: string[] = [];
  const indicators = typingIndicators({
    send: async (channelId, action) => {
      sentTyping.push(`${action} ${channelId}`);
    },
    every: 60_000,
  });
  const replies = typingOf(indicators);
  const { greeter } = wiring(true);
  const replying: Greeter = {
    ...greeter,
    chat: {
      ...greeter.chat,
      startTyping: (channelId) => indicators.start(channelId),
    },
    model: () => ({
      answer: async (prompt) => {
        // A reply starts typing in the same DM while the greeting is written.
        replies.start('dm-1');
        return greeter.model().answer(prompt);
      },
      cancel: () => {},
    }),
  };
  await greet(replying);
  // The greeting stopped its own indicator; the reply's is still showing.
  expect(sentTyping).toEqual(['start dm-1']);
  await replies.stop('dm-1');
  expect(sentTyping).toEqual(['start dm-1', 'stop dm-1']);
});

test('the vault is promised only when a one-item search answers', async () => {
  const searches: unknown[] = [];
  const vault = (answer: 'ok' | 'not_found' | 'throws') => ({
    team: async () => 'team-1',
    search: async (teamId: string, query: { query: string; limit: number }) => {
      searches.push([teamId, query]);
      if (answer === 'throws') throw new Error('unreachable');
      return answer === 'ok'
        ? {
            kind: 'ok' as const,
            status: 200,
            value: { items: [], nextCursor: null },
            wake: 'w',
          }
        : { kind: 'refused' as const, code: 'not_found' as const, wake: 'w' };
    },
  });
  // A wait that never ends: only the vault's answer decides.
  const never = () => new Promise<void>(() => {});
  expect(await vaultAnswers(vault('ok'), never)).toBe(true);
  expect(await vaultAnswers(vault('not_found'), never)).toBe(false);
  expect(await vaultAnswers(vault('throws'), never)).toBe(false);
  expect(searches[0]).toEqual(['team-1', { query: '', limit: 1 }]);
});

test('the greeting runs under the parent the agent sets, and on its own before', async () => {
  const parent = greetingParent();
  const entered: string[] = [];
  expect(await parent.around(async () => 'alone')).toBe('alone');
  parent.set({
    run: (operation) => {
      entered.push('start span');
      return operation();
    },
  });
  expect(await parent.around(async () => 'under')).toBe('under');
  expect(entered).toEqual(['start span']);
});

test('a vault that takes too long is not promised, and its wait is bounded', async () => {
  const waited: number[] = [];
  const slow = {
    team: async () => 'team-1',
    search: () => new Promise<never>(() => {}),
  };
  expect(
    await vaultAnswers(slow, async (ms) => {
      waited.push(ms);
    })
  ).toBe(false);
  expect(waited).toEqual([2_500]);
});
