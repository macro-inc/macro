import { afterEach, expect, test } from 'bun:test';
import { shell } from '../../../context/index.ts';
import { output } from '../../../context/shell.ts';
import { commit, concerns, selfEditMessage, wakeMessage } from '../commit.ts';
import { conflictLine } from '../guard.ts';
import { githubRepo } from '../repository.ts';
import { type Sandbox, sandbox } from './sandbox.ts';

const made: Sandbox[] = [];
const setup = async (): Promise<Sandbox> => {
  const box = await sandbox();
  made.push(box);
  return box;
};
afterEach(async () => {
  for (const box of made.splice(0)) await box.remove();
});

const wait = 0;

test('commits changes and pushes; a clean tree is a no-op', async () => {
  const box = await setup();
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'tick: ok', wait)).toBe('pushed');
  expect(await box.subjects(box.live, 'origin/main')).toBe('tick: ok\ninit\n');
  expect(await commit(box.repository(), 'again', wait)).toBe('clean');
});

test("never runs the workspace's git hooks: they are files the agent can write", async () => {
  const box = await setup();
  const ran = `${box.live}/hook-ran`;
  const hooks = ['pre-commit', 'post-commit', 'pre-push', 'post-rewrite'].map(
    (hook) => `${box.live}/.git/hooks/${hook}`
  );
  for (const hook of hooks)
    await box.write(hook, `#!/bin/sh\ntouch ${ran}\nexit 1\n`);
  await output(shell, ['chmod', '+x', ...hooks]);
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'tick: ok', wait)).toBe('pushed');
  expect(await box.exists(ran)).toBe(false);
});

test('with no remote, a commit stays local and nothing alarms', async () => {
  const box = await setup();
  await box.git(box.live, 'remote', 'remove', 'origin');
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'tick: ok', wait)).toBe('committed');
  expect(await commit(box.repository(), 'again', wait)).toBe('clean');
  expect(box.sent).toEqual([]);
  expect(box.logged).toEqual([]);
  expect(await box.subjects(box.remote)).toBe('init\n');
});

test('off main, a commit is never pulled or pushed', async () => {
  const box = await setup();
  await box.theirs('owner.md', 'o\n');
  await box.git(box.live, 'checkout', '-q', '-b', 'side');
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'side work', wait)).toBe('committed');
  expect(await box.exists(`${box.live}/owner.md`)).toBe(false);
  expect(await box.subjects(box.remote)).toBe('theirs: owner.md\ninit\n');
});

test('two clones pushing: the commit pulls theirs with --rebase, then pushes on top', async () => {
  const box = await setup();
  await box.theirs('owner.md', 'from the owner\n');
  await box.write(`${box.live}/state/memory/notes.md`, 'mine\n');
  expect(await commit(box.repository(), 'tick: ok', wait)).toBe('pushed');
  expect(await box.read(`${box.live}/owner.md`)).toBe('from the owner\n');
  // Linear: the agent's commit is replayed on top of theirs, no merge commit.
  expect(await box.subjects(box.remote)).toBe(
    'tick: ok\ntheirs: owner.md\ninit\n'
  );
  expect(await box.git(box.live, 'rev-parse', 'HEAD')).toBe(
    await box.git(box.remote, 'rev-parse', 'main')
  );

  // Nothing of the agent's to push, and the owner pushed again: still pulled.
  await box.theirs('owner.md', 'again\n');
  expect(await commit(box.repository(), 'tick: ok', wait)).toBe('clean');
  expect(await box.read(`${box.live}/owner.md`)).toBe('again\n');
  expect(box.sent).toEqual([]);
});

test('a rebase conflict is aborted: local commits stay, nothing is pushed, one alarm, and the next wake retries', async () => {
  const box = await setup();
  const theirs = await box.theirs('code.ts', 'one\ntwo\nthree\nfour\nTHEIRS\n');
  await box.write(`${box.live}/code.ts`, 'one\ntwo\nthree\nfour\nMINE\n');
  expect(await commit(box.repository(), 'mine', wait)).toBe('rebase-conflict');
  // No rebase left half done, the agent's commit and tree as they were.
  expect(
    (await box.raw(box.live, ['rev-parse', '-q', '--verify', 'REBASE_HEAD']))
      .code
  ).not.toBe(0);
  expect(await box.git(box.live, 'status', '--porcelain')).toBe('');
  expect(await box.subjects(box.live)).toBe('mine\ninit\n');
  expect(await box.read(`${box.live}/code.ts`)).toContain('MINE');
  expect(await box.remoteSha()).toBe(theirs);
  expect(box.sent).toEqual([conflictLine(theirs)]);
  expect(box.marker.sha).toBe(theirs);

  // The next wake tries again; still conflicting, it says nothing new.
  await box.write(`${box.live}/state/memory/notes.md`, 'later\n');
  expect(await commit(box.repository(), 'later', wait)).toBe('rebase-conflict');
  expect(box.sent).toHaveLength(1);
  expect(await box.subjects(box.live)).toBe('later\nmine\ninit\n');

  // The owner backs their change out: the next commit goes through, and the alarm clears.
  await box.theirs('code.ts', 'one\ntwo\nthree\nfour\nfive\n');
  expect(await commit(box.repository(), 'none', wait)).toBe('pushed');
  expect(box.marker.sha).toBe('');
  expect(await box.read(`${box.live}/code.ts`)).toContain('MINE');
  expect(await box.subjects(box.remote)).toStartWith('later\nmine\ntheirs');

  // A new conflict is news again.
  await box.theirs('code.ts', 'one\ntwo\nthree\nfour\nTHEIRS 2\n');
  await box.write(`${box.live}/code.ts`, 'one\ntwo\nthree\nfour\nMINE 2\n');
  expect(await commit(box.repository(), 'mine 2', wait)).toBe(
    'rebase-conflict'
  );
  expect(box.sent).toHaveLength(2);
});

test('a pull that fails for any other reason is not an alarm; the next commit retries', async () => {
  const box = await setup();
  await box.git(
    box.live,
    'remote',
    'set-url',
    'origin',
    `${box.root}/gone.git`
  );
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'state', wait)).toBe('pull-failed');
  expect(box.logged).toEqual(['commit: pull failed; will retry']);
  expect(box.sent).toEqual([]);
  expect(await box.subjects(box.live)).toBe('state\ninit\n');
  await box.git(box.live, 'remote', 'set-url', 'origin', box.remote);
  expect(await commit(box.repository(), 'none', wait)).toBe('pushed');
  expect(await box.subjects(box.remote)).toBe('state\ninit\n');
});

test('a remote with no main yet: nothing to pull, and the first push makes it', async () => {
  const box = await setup();
  await box.git(box.remote, 'update-ref', '-d', 'refs/heads/main');
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'first', wait)).toBe('pushed');
  expect(await box.subjects(box.remote)).toBe('first\ninit\n');
});

test('someone pushing between the pull and the push: no alarm, the next commit pulls it and pushes', async () => {
  const box = await setup();
  let raced = false;
  const racing = box.repository({
    git: async (args, options) => {
      if (args[0] === 'push' && !raced) {
        raced = true;
        await box.theirs('owner.md', 'raced\n');
      }
      return box.repository().git(args, options);
    },
  });
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(racing, 'state', wait)).toBe('push-failed');
  expect(box.sent).toEqual([]);
  expect(await commit(box.repository(), 'none', wait)).toBe('pushed');
  expect(await box.subjects(box.remote)).toBe(
    'state\ntheirs: owner.md\ninit\n'
  );
});

test('a held lock leaves the change for the next commit', async () => {
  const box = await setup();
  box.lock.held = true;
  await box.write(`${box.live}/notes.md`, 'n\n');
  expect(await commit(box.repository(), 'state', wait)).toBe('locked');
  expect(await box.git(box.live, 'status', '--porcelain')).toContain(
    'notes.md'
  );
});

test('the conflict alarm is one plain line naming the SHA', () => {
  const line = conflictLine('a'.repeat(40));
  expect(line).toContain('aaaaaaaaaaaa');
  expect(line).not.toMatch(/[<>`\n]/);
});

test('no identity: nothing is committed or pushed, and the work stays staged', async () => {
  const box = await setup();
  await box.write(`${box.live}/x`, 'x\n');
  const before = await box.git(box.live, 'rev-parse', 'HEAD');
  box.env.GIT_AUTHOR_NAME = '';
  box.env.GIT_COMMITTER_NAME = '';
  expect(await commit(box.repository(), 'm', wait)).toBe('commit-failed');
  expect(await box.git(box.live, 'rev-parse', 'HEAD')).toBe(before);
  expect(await box.git(box.live, 'status', '--porcelain')).toContain('A  x');
  expect(box.logged[0]).toContain('not committed');
});

test("self-edit message: the files changed and the session's folder", () => {
  expect(
    selfEditMessage(
      ' M notes.md\n?? src/b.ts\nR  old.md -> docs/new.md\n M "a b.md"\n',
      '/home/owner/Code/macro'
    )
  ).toBe('self-edit: a b.md,b.ts,new.md,notes.md (session in macro)');
  expect(selfEditMessage('')).toBe('self-edit: push (session in ?)');
});

test('the self-commit hook only concerns edits inside the repository, and every Stop', () => {
  const edit = (file: string) => ({
    hook_event_name: 'PostToolUse',
    tool_input: { file_path: file },
  });
  expect(concerns(edit('/r/agent/notes.md'), '/r/agent')).toBe(true);
  expect(concerns(edit('/r/other/notes.md'), '/r/agent')).toBe(false);
  expect(concerns({ hook_event_name: 'PostToolUse' }, '/r/agent')).toBe(false);
  expect(concerns({ hook_event_name: 'Stop' }, '/r/agent')).toBe(true);
});

test('the commit after a wake is named for what woke the agent', () => {
  const facts = { tick: 'tick', reason: 'snapshot changed', ok: true };
  expect(wakeMessage({ ...facts, source: 'schedules', schedule: 'tick' })).toBe(
    'tick: ok (snapshot changed)'
  );
  expect(
    wakeMessage({ ...facts, source: 'schedules', schedule: 'tick', ok: false })
  ).toBe('tick: failed (snapshot changed)');
  expect(
    wakeMessage({ ...facts, source: 'schedules', schedule: 'nudge' })
  ).toBe('nudge: ok');
  expect(
    wakeMessage({ ...facts, source: 'conversations', schedule: undefined })
  ).toBe('conversations: ok');
});

test("a GitHub remote's URL names its repository; anything else doesn't", () => {
  expect(githubRepo('https://github.com/example/agent.git\n')).toBe(
    'example/agent'
  );
  expect(githubRepo(`git@${'github.com'}:example/agent`)).toBe('example/agent');
  expect(githubRepo('/tmp/remote.git')).toBeUndefined();
});
