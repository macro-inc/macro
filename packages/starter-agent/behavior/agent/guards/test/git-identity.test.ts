import { expect, test } from 'bun:test';
import { noIdentity } from '../../../context/identity.ts';
import {
  configReason,
  ghAuthReason,
  gitIdentity,
  gitIdentityGuard,
} from '../git-identity.ts';

const AGENT = {
  AGENT_SESSION: '1',
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'agent@example.com',
};
const USER = {};
const bash = (
  command: string,
  environment: Readonly<Record<string, string | undefined>> = AGENT
) => gitIdentity({ tool: 'Bash', input: { command }, cwd: '/w', environment });
const edit = (
  file_path: string,
  environment: Readonly<Record<string, string | undefined>> = AGENT
) =>
  gitIdentity({ tool: 'Edit', input: { file_path }, cwd: '/w', environment });

test("the agent's sessions can't write identity or credentials at any scope", () => {
  for (const command of [
    'git config user.name Ada',
    'git config user.email agent@example.com',
    'git config --local user.email agent@example.com',
    'git config --global user.name "Someone Else"',
    'git config --system user.email x@y',
    'git config --worktree user.name x',
    'git -C /home/owner/project config user.name x',
    'git -c a.b=c config user.name x',
    'git config set user.name x',
    'git config set --global user.email x',
    'git config --add user.email x',
    'git config --replace-all user.name x',
    'git config --unset user.name',
    'git config unset user.email',
    'git config --remove-section user',
    'git config author.name x',
    'git config committer.email x',
    'git config credential.helper store',
    'git config --global credential.https://github.com.helper "!gh auth git-credential"',
    'git config --file ~/.gitconfig user.name x',
    'git config --edit',
    'cd /home/owner/project && git config user.name x',
    'x=$(git config user.name x)',
    'bash -c "git config user.name x"',
    'env A=1 git config user.name x',
  ])
    expect([command, bash(command)]).toEqual([command, configReason]);
});

test("a session without an identity is still the agent's", () => {
  expect(bash('git config user.name x', noIdentity)).toBe(configReason);
});

test('reads and other keys pass', () => {
  for (const command of [
    'git config user.name',
    'git config --get user.email',
    'git config --get-regexp ^user',
    'git config --show-origin --get user.email',
    'git config --show-origin user.email',
    'git config get user.name',
    'git config --list',
    'git config -l',
    'git config list --show-origin',
    'git config credential.helper',
    'git config user.useConfigOnly true',
    'git config rerere.enabled true',
    'git -C /x config --local --get user.name',
  ])
    expect([command, bash(command)]).toEqual([command, undefined]);
});

test('a command in quoted text is not a command', () => {
  expect(
    bash('bin/agent postMessage "run git config user.name Ada"')
  ).toBeUndefined();
  expect(
    bash("git commit -m 'git config user.email agent@example.com'")
  ).toBeUndefined();
  expect(bash('echo "git config user.name Ada"')).toBeUndefined();
  expect(bash('echo "gh auth setup-git"')).toBeUndefined();
  expect(bash('grep -n "git config user.name" README.md')).toBeUndefined();
});

test("the machine user's own sessions aren't blocked", () => {
  expect(bash('git config user.name "Bo"', USER)).toBeUndefined();
  expect(
    bash('git config --local user.email owner@example.com', USER)
  ).toBeUndefined();
  expect(bash('git config --unset user.name', USER)).toBeUndefined();
  expect(
    bash("git config credential.helper '!gh auth git-credential'", USER)
  ).toBeUndefined();
  expect(bash('gh auth setup-git', USER)).toBeUndefined();
  expect(edit('/r/.git/config', USER)).toBeUndefined();
  expect(bash('echo x >> .git/config', USER)).toBeUndefined();
  expect(
    bash('git config user.name x', { GIT_AUTHOR_NAME: 'Bo' })
  ).toBeUndefined();
});

test("gh auth writes are denied to the agent; reading the login isn't", () => {
  expect(bash('gh auth setup-git')).toBe(ghAuthReason);
  expect(bash('gh auth login --with-token')).toBe(ghAuthReason);
  expect(bash('gh auth switch')).toBe(ghAuthReason);
  expect(bash('gh auth status')).toBeUndefined();
});

test('other ways into a shared config file', () => {
  expect(edit('/home/owner/project/.git/config')).toBe(configReason);
  expect(edit('/home/owner/.gitconfig')).toBe(configReason);
  expect(edit('/home/owner/.config/git/config')).toBe(configReason);
  expect(edit('/home/owner/project/src/config')).toBeUndefined();
  expect(
    gitIdentity({
      tool: 'Write',
      input: { file_path: '/home/owner/.gitconfig', content: '[user]' },
      cwd: '/w',
      environment: AGENT,
    })
  ).toBe(configReason);
  expect(
    bash('printf "[user]\\n name=Ada\\n" >> /home/owner/project/.git/config')
  ).toBe(configReason);
  expect(bash("sed -i 's/a/b/' .git/config")).toBe(configReason);
  expect(bash('cat .git/config')).toBeUndefined();
  expect(bash('cp .git/config "$TMPDIR/before"')).toBeUndefined();
  expect(bash('cp /tmp/x .git/config')).toBe(configReason);
});

test("the guard reads who it is from the call's environment", () => {
  const check = (environment: Record<string, string>) =>
    gitIdentityGuard.check({
      tool: 'Bash',
      input: { command: 'git config user.email x@y' },
      cwd: '/w',
      environment,
    });
  expect(gitIdentityGuard.name).toBe('git-identity');
  expect(check({ AGENT_SESSION: '1' })).toBe(configReason);
  expect(check({ GIT_AUTHOR_NAME: 'Ada' })).toBeUndefined();
  expect(check({})).toBeUndefined();
});
