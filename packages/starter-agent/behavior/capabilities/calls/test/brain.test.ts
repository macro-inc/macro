import { expect, test } from 'bun:test';
import { noIdentity } from '../../../context/identity.ts';
import type { WorkRequest } from '../../../contracts.ts';
import {
  askContent,
  brainEnvironment,
  briefing,
  firstMessage,
  handOff,
  postInChat,
  rules,
  type Signal,
  systemAppend,
  type ToolStart,
  turnQueue,
  workLabel,
} from '../brain.ts';

const owner = 'macro|owner@example.com';
const persona = { name: 'Agent', owner };

test("askContent: the card, the cut-off note, what was said since, then the line with the speaker's id", () => {
  const content = askContent({
    who: owner,
    name: 'Ada',
    text: 'What now?',
    context: ['Bo: hi'],
    cutOff: true,
    card: 'Ada is your owner.',
  });
  expect(
    content.startsWith('Ada is your owner.\n\n(Someone talked over you')
  ).toBe(true);
  expect(content).toContain('Said on the call since you last spoke:\nBo: hi');
  expect(content.endsWith(`Ada [${owner}] says to you: What now?`)).toBe(true);
  expect(
    askContent({
      who: 'a',
      name: 'Ann',
      text: 'go on',
      context: [],
      cutOff: true,
      heardBefore: 'The build started in',
    })
  ).toContain(
    'They heard this much of your last answer: "The build started in"'
  );
});

test("the call's system prompt is the call rules, then who the agent is, then the charter", () => {
  const prompt = systemAppend(persona, 'I am Agent.', 'Mission: test.');
  expect(prompt.startsWith(rules(persona))).toBe(true);
  expect(prompt).toContain('# Who you are\n\nI am Agent.');
  expect(prompt).toContain('# Your charter (AGENT.md)');
  expect(prompt.indexOf('I am Agent.')).toBeLessThan(
    prompt.indexOf('Mission: test.')
  );
  expect(systemAppend(persona, undefined, undefined)).toBe(rules(persona));
  expect(systemAppend(persona, '', 'Mission: test.')).not.toContain(
    '# Who you are'
  );
});

test('the call rules name the agent, its owner, and its capabilities', () => {
  const text = rules(persona);
  expect(text).toContain('You are Agent');
  expect(text).toContain('bin/agent list');
  expect(text).toContain('bin/agent describe <name>');
  expect(text).toContain("bin/agent <capability> '<json>'");
  expect(text).toContain(owner);
  expect(rules({ name: 'Ada', owner })).toContain('You are Ada');
});

test('the system prompt is the same for every call: what differs goes in the first message', () => {
  const first = firstMessage({
    briefing: 'BRIEF',
    callId: 'call-1',
    channel: 'ch-1',
    note: 'Nobody asked you here.',
  });
  expect(
    first.startsWith(
      'BRIEF\n\nYou just joined call call-1 in Macro channel ch-1'
    )
  ).toBe(true);
  expect(first).toContain(
    `bin/agent postMessage '{"channelId":"ch-1","text":"<text>"}'`
  );
  expect(
    first.endsWith('Nobody asked you here. Reply with exactly: ready')
  ).toBe(true);
  expect(rules(persona)).not.toContain('call-1');
  const placedCall = firstMessage({
    briefing: '',
    callId: 'call-2',
    placed: {
      target: 'macro|cy@example.com',
      asker: owner,
      opening: "Hi, it's Agent. About the launch.",
    },
  });
  expect(placedCall).toContain(
    `You placed this call to macro|cy@example.com, at ${owner}'s request.`
  );
  expect(placedCall).toContain(
    '"Hi, it\'s Agent. About the launch." They have heard that, so never say it again'
  );
});

test("a call's brain runs as the agent, or as nobody, and without the audio libraries' LD_LIBRARY_PATH", () => {
  const assistant = { GH_TOKEN: 'agents', GIT_AUTHOR_NAME: 'Agent' };
  expect(
    brainEnvironment(
      { LD_LIBRARY_PATH: '/x', KEEP: 'y', GH_TOKEN: 'owners' },
      assistant
    )
  ).toEqual({ KEEP: 'y', GH_TOKEN: 'agents', GIT_AUTHOR_NAME: 'Agent' });
  const nobody = brainEnvironment(
    { GH_TOKEN: 'owners', LD_LIBRARY_PATH: '/x', KEEP: 'y' },
    noIdentity
  );
  expect(nobody.GH_TOKEN).toBeUndefined();
  expect(nobody.LD_LIBRARY_PATH).toBeUndefined();
  expect(nobody.GIT_AUTHOR_NAME).toBe('');
  expect(nobody.KEEP).toBe('y');
});

const join = (...parts: readonly string[]) => parts.join('/');

test('the briefing loads the shared notes and asks, and recent commits', async () => {
  const files: Readonly<Record<string, string>> = {
    '/assistant/state/memory/shared/notes.md': 'NOTES',
  };
  const ports = (git: number) => ({
    disk: { read: async (path: string) => files[path] },
    shell: {
      run: async () => ({ code: git, stdout: 'abc123 a commit', stderr: '' }),
    },
    config: { root: '/assistant', charter: '/assistant/AGENT.md' },
    state: {
      sharedFile: (name: string) => `/assistant/state/memory/shared/${name}`,
    },
    join,
  });
  const loaded = await briefing(ports(0));
  expect(loaded).toContain(
    '<file path="state/memory/shared/notes.md">\nNOTES\n</file>'
  );
  // A file that isn't there is loaded as empty, so the agent doesn't go looking for it.
  expect(loaded).toContain(
    '<file path="state/memory/shared/asks.md">\n\n</file>'
  );
  expect(loaded).toContain(
    '<command cmd="git log --oneline -20">\nabc123 a commit\n</command>'
  );
  // A command that fails is left out.
  expect(await briefing(ports(1))).not.toContain('git log');
});

test("hand_off hands the agent a task that outlives the call, reporting back in the call's channel", async () => {
  const started: WorkRequest[] = [];
  const events: (readonly [string, unknown])[] = [];
  const ports = {
    work: {
      start: async (request: WorkRequest) => {
        started.push(request);
        return { id: `w${started.length}` };
      },
    },
    emit: (type: string, data?: unknown) => events.push([type, data]),
  };
  expect(
    await handOff(ports, {
      task: "draft the notes (Ada asked: 'send them')",
      channelId: 'ch-1',
    })
  ).toBe('w1');
  await handOff(ports, { task: 'build the thing' });
  expect(started).toEqual([
    {
      task: "draft the notes (Ada asked: 'send them')",
      label: "draft the notes (Ada asked: 'send",
      channelId: 'ch-1',
    },
    { task: 'build the thing', label: 'build the thing', channelId: undefined },
  ]);
  expect(events.map(([type]) => type)).toEqual([
    'brain.hand_off',
    'brain.hand_off',
  ]);
  expect(workLabel('  ')).toBe('from a call');
});

test('a hand-off that fails is logged and thrown, so the brain can say so', async () => {
  const events: unknown[] = [];
  const failure = await handOff(
    {
      work: { start: () => Promise.reject(new Error('no runner')) },
      emit: (_type, data) => events.push(data),
    },
    { task: 'deploy' }
  ).catch((error: unknown) => error);
  expect(String(failure)).toContain('no runner');
  expect(events).toEqual([{ task: 'deploy', error: 'Error: no runner' }]);
});

test("post_chat posts in this call's chat and tells the brain; a failure comes back as words", async () => {
  const posted: [string, string][] = [];
  const events: [string, unknown][] = [];
  const emit = (type: string, data?: unknown) => events.push([type, data]);
  const ok = await postInChat(
    {
      postChat: async (callId, text) => void posted.push([callId, text]),
      emit,
    },
    'call-1',
    'https://macro.com/app/x'
  );
  expect(ok).toEqual({ ok: true, said: "Posted in the call's chat." });
  expect(posted).toEqual([['call-1', 'https://macro.com/app/x']]);
  const failed = await postInChat(
    { postChat: () => Promise.reject(new Error('403')), emit },
    'call-1',
    'hi'
  );
  expect(failed.ok).toBe(false);
  expect(failed.said).toContain('403');
  expect(events).toEqual([
    ['brain.post_chat', { chars: 23 }],
    ['brain.post_chat', { error: 'Error: 403' }],
  ]);
});

test('post_chat never posts the silent sentinel: it goes back to the brain', async () => {
  const posted: string[] = [];
  const result = await postInChat(
    {
      postChat: async (_callId, text) => void posted.push(text),
      emit: () => {},
    },
    'call-1',
    ' (silent) '
  );
  expect(result.ok).toBe(false);
  expect(posted).toEqual([]);
});

test('the call rules send links and ids to the chat, not the voice', () => {
  expect(rules(persona)).toContain('post_chat');
});

const collect = async (turn: AsyncIterable<string | ToolStart>) => {
  const parts: (string | ToolStart)[] = [];
  for await (const part of turn) parts.push(part);
  return parts;
};
const text = (value: string): Signal => ({ kind: 'text', text: value });
const end: Signal = { kind: 'end' };
/** Lets everything that is ready to run, run. */
const settle = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

test('turns run one at a time: each message gets its one result, and an abandoned turn drains without leaking into the next', async () => {
  const sent: string[] = [];
  const events: string[] = [];
  const turns = turnQueue({
    send: (content) => sent.push(content),
    emit: (type) => events.push(type),
    elapsed: () => 0,
  });
  expect(turns.running()).toBe(false);
  const first = turns.ask('one', 1)[Symbol.asyncIterator]();
  const opening = first.next();
  const second = collect(turns.ask('two', 2));
  await settle();
  // The second message isn't sent until the first has its result.
  expect(sent).toEqual(['one']);
  expect(turns.running()).toBe(true);
  turns.deliver(text('One. '));
  expect((await opening).value).toBe('One. ');
  // Talked over: nobody reads the first turn any more, but its text still arrives.
  turns.deliver(text('Still one.'));
  turns.deliver({ kind: 'tool', tool: 'Bash' });
  turns.deliver(end);
  await settle();
  expect(sent).toEqual(['one', 'two']);
  turns.deliver(text('Two.'));
  turns.deliver(end);
  expect(await second).toEqual(['Two.']);
  expect(turns.running()).toBe(false);
  expect(events).toEqual(['brain.first_text', 'brain.first_text']);
  // Nothing is running: a stray signal goes nowhere.
  turns.deliver(text('late'));
});

test('a turn yields each tool as it starts, between its words', async () => {
  const turns = turnQueue({
    send: () => undefined,
    emit: () => undefined,
    elapsed: () => 0,
  });
  const turn = collect(turns.ask('look it up', 1));
  await settle();
  turns.deliver(text('Checking.'));
  turns.deliver({ kind: 'tool', tool: 'Bash' });
  turns.deliver(text('Found it.'));
  turns.deliver(end);
  expect(await turn).toEqual(['Checking.', { tool: 'Bash' }, 'Found it.']);
});
