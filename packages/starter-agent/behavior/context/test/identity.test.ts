import { expect, test } from 'bun:test';
import { agentEnvironment, githubToken, sessionMarker } from '../identity.ts';

const config = { identity: { name: 'Ada', email: 'agent@example.com' } };
const credentials = (stored: Readonly<Record<string, string>>) => ({
  get: async (name: string) => {
    const value = stored[name];
    if (value === undefined) throw new Error(`no credential ${name}`);
    return value;
  },
});

test('with its token, git and gh act as the agent, under its configured name', async () => {
  const environment = await agentEnvironment({
    config,
    credentials: credentials({ [githubToken]: 't' }),
  });
  expect(environment).toMatchObject({
    [sessionMarker]: '1',
    GH_TOKEN: 't',
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
  });
  expect(environment.GH_CONFIG_DIR).toBeUndefined();
});

test('without a GitHub token git still commits as the agent, and gh has no login', async () => {
  const environment = await agentEnvironment({
    config,
    credentials: credentials({}),
  });
  expect(environment).toMatchObject({
    [sessionMarker]: '1',
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'agent@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'agent@example.com',
    GH_CONFIG_DIR: '/nonexistent',
    GIT_TERMINAL_PROMPT: '0',
  });
  expect(environment.GH_TOKEN).toBeUndefined();
  expect(environment.GITHUB_TOKEN).toBeUndefined();
});
