import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { GitWriter, gitCli, Workspace } from './workspace.ts';

const TEMPLATE = new URL('../template/', import.meta.url).pathname;
/** A bare remote and a clone of it with one commit, both in a fresh temp dir. */
async function clonedWorkspace(): Promise<{
  root: string;
  remote: string;
  clone: string;
}> {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-workspace-')
  );
  const remote = `${root}/remote.git`;
  const clone = `${root}/workspace`;
  const git = gitCli(root);
  await git(['init', '-q', '--bare', '-b', 'main', remote]);
  await git(['clone', '-q', remote, clone]);
  const inClone = gitCli(clone);
  await inClone(['config', 'user.email', 'ada@example.com']);
  await inClone(['config', 'user.name', 'Ada']);
  await nodeFs.writeFile(`${clone}/OPERATING.md`, '# Ada\n');
  await inClone(['add', '-A']);
  await inClone(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  await inClone(['push', '-q', '-u', 'origin', 'main']);
  return { root, remote, clone };
}
test('the persona template parses as a workspace', async () => {
  const persona = await new Workspace(TEMPLATE).persona();
  assert.deepEqual(persona.brainLock, '0.2.0');
  assert.equal(persona.jev.mode, 'all');
  assert.deepEqual(persona.jev.questions, {});
  assert.deepEqual(persona.events.events, ['*']);
  assert.deepEqual(persona.events.concurrency, {
    respond: 1,
    heartbeat: 1,
    work: 2,
  });
  assert.deepEqual(persona.budget.perRunUsd.work, 20);
});
test('commitTurn commits and pushes as "turn <id>: <summary>", never history or logs', async () => {
  const { root, remote, clone } = await clonedWorkspace();
  const workspace = new Workspace(clone);
  const writer = new GitWriter(workspace, gitCli(clone));
  await writer.write('memory/notes/ada.md', '# ada\n');
  await nodeFs.mkdir(`${clone}/history`);
  await nodeFs.writeFile(
    `${clone}/history/channel.jsonl`,
    '{"text":"private"}\n'
  );
  await nodeFs.mkdir(`${clone}/log`);
  await nodeFs.writeFile(`${clone}/log/decisions.jsonl`, '{}\n');
  const outcome = await writer.commitTurn(
    'respond-1',
    'replied to Bo\nsecond line'
  );
  assert.deepEqual(outcome, 'pushed');
  const remoteGit = gitCli(root);
  const subject = await remoteGit([
    '--git-dir',
    remote,
    'log',
    '-1',
    '--format=%s',
    'main',
  ]);
  assert.deepEqual(subject.stdout.trim(), 'turn respond-1: replied to Bo');
  const files = await remoteGit([
    '--git-dir',
    remote,
    'ls-tree',
    '-r',
    '--name-only',
    'main',
  ]);
  assert.deepEqual(files.stdout.trim().split('\n').sort(), [
    '.gitignore',
    'OPERATING.md',
    'memory/notes/ada.md',
  ]);
});
test('a rejected push rebases onto the remote and pushes again', async () => {
  const { root, remote, clone } = await clonedWorkspace();
  const other = `${root}/other`;
  await gitCli(root)(['clone', '-q', remote, other]);
  const otherGit = gitCli(other);
  await otherGit(['config', 'user.email', 'bo@example.com']);
  await otherGit(['config', 'user.name', 'Bo']);
  await nodeFs.writeFile(`${other}/README.md`, 'from elsewhere\n');
  await otherGit(['add', '-A']);
  await otherGit([
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'elsewhere',
  ]);
  await otherGit(['push', '-q', 'origin', 'main']);
  const writer = new GitWriter(new Workspace(clone), gitCli(clone));
  await writer.write('memory/self.json', '{}\n');
  const outcome = await writer.commitTurn('heartbeat-1', 'nothing due');
  assert.deepEqual(outcome, 'pushed');
  const log = await gitCli(root)([
    '--git-dir',
    remote,
    'log',
    '--format=%s',
    'main',
  ]);
  assert.deepEqual(log.stdout.trim().split('\n'), [
    'turn heartbeat-1: nothing due',
    'elsewhere',
    'seed',
  ]);
});
test('a clean workspace commits nothing', async () => {
  const { clone } = await clonedWorkspace();
  const writer = new GitWriter(new Workspace(clone), gitCli(clone));
  await writer.commit('sync');
  const outcome = await writer.commit('sync again');
  assert.deepEqual(outcome, 'clean');
  const gitignore = await nodeFs.readFile(`${clone}/.gitignore`, 'utf8');
  assert.ok(gitignore.includes('history/\nlog/\ncache/\nwork/\nsecrets\n'));
});
test('git receives only repo credentials, never the Macro API key', async () => {
  const values = {
    MACRO_REPO_URL: 'https://git.example.com/repo.git',
    MACRO_REPO_TOKEN: 'test-repo-token',
    MACRO_API_KEY: 'test-api-key',
  };
  const previous = new Map<string, string | undefined>();
  const root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'brain-'));
  try {
    for (const [name, value] of Object.entries(values)) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    const result = await gitCli(root)([
      '-c',
      'alias.credentials=!printf "%s|%s|%s" "$MACRO_REPO_URL" "$MACRO_REPO_TOKEN" "$MACRO_API_KEY"',
      'credentials',
    ]);
    assert.deepEqual(result.code, 0);
    assert.deepEqual(
      result.stdout,
      `${values.MACRO_REPO_URL}|${values.MACRO_REPO_TOKEN}|`
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await nodeFs.rm(root, { recursive: true });
  }
});
