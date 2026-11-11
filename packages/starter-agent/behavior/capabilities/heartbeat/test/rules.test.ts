import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import { memoryCredentials } from '../../../context/credentials.ts';
import { heartbeatModule } from '../index.ts';

// Every rule here is checked before anything is read or run, so no context is needed.
const refused = async (name: string, input: unknown): Promise<string> => {
  const called = await invoke(heartbeatModule, name, {}, input);
  expect(called.kind).toBe('failed');
  return called.kind === 'failed' ? called.error : '';
};

test('commit and land refuse a blank message or branch', async () => {
  expect(await refused('commit', { message: '  ' })).toContain(
    'message must not be empty'
  );
  expect(await refused('land', { branch: ' ' })).toContain(
    'branch must not be empty'
  );
});

test("logMerge refuses a repo that isn't owner/name and a number that isn't a positive integer", async () => {
  expect(await refused('logMerge', { repo: 'macro', number: 1 })).toContain(
    'repo must be owner/name'
  );
  for (const number of [0, -3, 1.5])
    expect(
      await refused('logMerge', { repo: 'example/agent', number })
    ).toContain('number must be a positive integer');
  expect(
    (
      await invoke(
        heartbeatModule,
        'logMerge',
        {},
        { repo: 'a/b', number: '1' }
      )
    ).kind
  ).toBe('invalid');
});

test('scheduleAction refuses an empty line, request or file', async () => {
  const schedule = { every: '10m' };
  expect(
    await refused('scheduleAction', { name: 'x', schedule, dmOwner: '' })
  ).toContain('dmOwner must not be empty');
  expect(
    await refused('scheduleAction', { name: 'x', schedule, wake: '' })
  ).toContain('wake must not be empty');
  expect(
    await refused('scheduleAction', {
      name: 'x',
      schedule,
      wake: 'look',
      ifFile: '',
    })
  ).toContain('ifFile must not be empty');
});

test('clockReport takes a whole count from 1 to 500, and only its own streams', async () => {
  for (const count of [0, 501, 2.5])
    expect(
      await refused('clockReport', { stream: 'heartbeat', count })
    ).toContain('count must be a whole number from 1 to 500');
  expect(
    (await invoke(heartbeatModule, 'clockReport', {}, { stream: 'other' })).kind
  ).toBe('invalid');
});

test('logMerge without a GitHub token says which credential to add, and runs nothing', async () => {
  const called = await invoke(
    heartbeatModule,
    'logMerge',
    { credentials: memoryCredentials() },
    { repo: 'example/agent', number: 7 }
  );
  expect(called.kind).toBe('failed');
  expect(called.kind === 'failed' ? called.error : '').toContain(
    'add the AGENT_GITHUB_TOKEN credential'
  );
});
