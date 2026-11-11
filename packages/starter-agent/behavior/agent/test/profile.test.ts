import { expect, test } from 'bun:test';
import { limits, profile } from '../profile.ts';

const at = profile({ root: '/home/owner/agent' });
const event = (name: string) => ({ name, payload: {} });

test("a wake works in the agent's own repository, with no other directory", () => {
  for (const name of ['conversations', 'schedules', 'mail', 'calls']) {
    const { cwd, directories } = at(event(name));
    expect(cwd).toBe('/home/owner/agent');
    expect(directories).toEqual([]);
  }
});

test("its limits follow the event's source, with a default for the rest", () => {
  expect(at(event('conversations'))).toMatchObject(limits.conversations ?? {});
  expect(at(event('mail'))).toMatchObject(limits.mail ?? {});
  expect(at(event('calls')).budgetUsd).toBeGreaterThan(0);
  expect(at(event('calls')).timeoutMs).toBeGreaterThan(0);
});
