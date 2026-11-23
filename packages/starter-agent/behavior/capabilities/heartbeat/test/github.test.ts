import { expect, test } from 'bun:test';
import { needsGithub } from '../live.ts';

test('what needs GitHub names the credential and that the owner adds it: the agent cannot store one', () => {
  const { message } = needsGithub('Reading a merged PR');
  expect(message).toContain('AGENT_GITHUB_TOKEN');
  expect(message).toContain('owner');
  expect(message).not.toContain('setCredential');
});
