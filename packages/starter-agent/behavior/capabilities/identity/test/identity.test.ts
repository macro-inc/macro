import { expect, test } from 'bun:test';
import type { Agent } from '@macro-inc/muppet/core/agent';
import { behavior } from '@macro-inc/muppet/core/behavior';
import { source } from '@macro-inc/muppet/core/event';
import { simple } from '@macro-inc/muppet/runtimes/simple';
import { memoryStore, scheduler } from '@macro-inc/muppet/utilities/schedules';
import { invoke } from '../../../../test/invoke.ts';
import {
  ensureIntroduction,
  identityHandlers,
  introduction,
} from '../../../events/handlers/identity.ts';
import { identityModule, readIdentity, writeIdentity } from '../index.ts';
import { introduce, known } from '../prompt.ts';

const now = Temporal.Instant.from('2026-01-05T10:00:00Z');
const clock = { now: () => now, sleep: async () => {} };

const fake = () => {
  const files = new Map<string, string>();
  const join = (...parts: readonly string[]) => parts.join('/');
  return {
    files,
    clock,
    join,
    state: { memory: (owner: string) => `/state/memory/${owner}` },
    disk: {
      read: async (path: string) => files.get(path),
      write: async (path: string, text: string) => {
        files.set(path, text);
      },
      exists: async (path: string) => files.has(path),
    },
  };
};

test.each([
  {
    scenario: 'a configured name',
    name: '  Agent  ',
    identity: undefined,
    asksForName: false,
  },
  {
    scenario: 'an empty name',
    name: '',
    identity: undefined,
    asksForName: true,
  },
  {
    scenario: 'a whitespace-only name',
    name: '  ',
    identity: undefined,
    asksForName: true,
  },
  {
    scenario: 'saved identity',
    name: 'Agent',
    identity: 'I am Pip, and I keep the calendar.',
    asksForName: false,
  },
])(
  'the identity hook handles $scenario on each wake',
  async ({ name, identity, asksForName }) => {
    const context = fake();
    if (identity !== undefined)
      await writeIdentity(context, { markdown: identity });

    const prompts: string[] = [];
    const failures: unknown[] = [];
    const agent: Agent = {
      wake: async ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return { kind: 'done', reply: '' };
      },
    };
    const wakes = async function* () {
      yield introduce;
      yield 'Reply to the owner';
    };

    await behavior()
      .decorate({
        ...context,
        config: { identity: { name, email: 'agent@example.com' } },
        agent,
      })
      .use(identityHandlers())
      .source({ wakes: source(wakes()) })
      .on(
        (sources) => sources.wakes,
        async (request, { wake }) => {
          await wake(request);
        }
      )
      .on(
        (sources) => sources.hooks.failed,
        async (failure) => {
          failures.push(failure);
        }
      )
      .run(
        simple({
          systemPrompt: '',
          load: async () => {
            throw new Error('no script is run');
          },
          signatures: async () => '',
          script: { file: import.meta.path, name: 'Script' },
        })
      );

    expect(failures).toEqual([]);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt.includes('What should I be called?')).toBe(asksForName);
      if (identity !== undefined) {
        expect(prompt).toContain(identity);
        expect(prompt).not.toContain('Your name is "Agent"');
      } else {
        expect(prompt).toContain('What is my purpose?');
        if (!asksForName) {
          expect(prompt).toContain('Your name is "Agent"');
          expect(prompt).toContain('never ask what to call yourself');
        }
      }
    }
  }
);

test('what it writes is what it reads back, whole, and what every wake is shown', async () => {
  const context = fake();
  await writeIdentity(context, {
    markdown: "  I am Pip. I keep Ada's calendar.\n\n",
  });
  expect(await readIdentity(context)).toBe("I am Pip. I keep Ada's calendar.");
  expect(known('I am Pip.')).toContain('I am Pip.');
  await writeIdentity(context, { markdown: 'I am Pip, and I am blunt.' });
  expect(await readIdentity(context)).toBe('I am Pip, and I am blunt.');
});

test('an empty identity is refused, and what was there stays', async () => {
  const context = fake();
  await writeIdentity(context, { markdown: 'I am Pip.' });
  const refused = await invoke(identityModule, 'writeIdentity', context, {
    markdown: '  ',
  });
  expect(refused).toMatchObject({ kind: 'failed' });
  expect(JSON.stringify(refused)).toContain('empty identity');
  expect(await readIdentity(context)).toBe('I am Pip.');
});

test('a new agent is woken once to introduce itself, and never again', async () => {
  const context = fake();
  const schedules = scheduler({ store: memoryStore(), clock, tz: 'UTC' });
  await ensureIntroduction(context, schedules);
  expect(
    (await schedules.list()).map(({ name, schedule }) => [name, schedule.data])
  ).toEqual([[introduction, { wake: introduce }]]);
  await schedules.remove(introduction);
  await ensureIntroduction(context, schedules);
  expect(await schedules.list()).toEqual([]);
});

test("an agent that already knows who it is isn't asked to introduce itself", async () => {
  const context = fake();
  await writeIdentity(context, { markdown: 'I am Pip.' });
  const schedules = scheduler({ store: memoryStore(), clock, tz: 'UTC' });
  await ensureIntroduction(context, schedules);
  expect(await schedules.list()).toEqual([]);
});
