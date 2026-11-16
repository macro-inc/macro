import { expect, test } from 'bun:test';
import { githubLanding } from '../live.ts';

const hosted =
  'https://gateway.macro.com/agent-git/macro%7Cagent%40example.com.git';

test('a hosted agent always lands through its own check, never GitHub', () => {
  expect(githubLanding({ token: false, pushUrl: hosted })).toBeUndefined();
  expect(githubLanding({ token: true, pushUrl: hosted })).toBeUndefined();
  expect(githubLanding({ token: false, pushUrl: undefined })).toBeUndefined();
});

test('a self-hosted agent with a GitHub token and remote lands through a PR', () => {
  expect(
    githubLanding({
      token: false,
      pushUrl: 'https://github.com/example/agent.git',
    })
  ).toBeUndefined();
  expect(
    githubLanding({
      token: true,
      pushUrl: 'https://github.com/example/agent.git',
    })
  ).toBe('example/agent');
});
