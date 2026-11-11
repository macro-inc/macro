import { expect, test } from 'bun:test';
import { callsReady } from '../config.ts';

test('calls stay off unless agent.json turns them on, whatever keys there are', async () => {
  const withKey = { has: async () => true };
  const withoutKey = { has: async () => false };
  expect(await callsReady({ calls: false }, withKey)).toBe(false);
  expect(await callsReady({ calls: true }, withoutKey)).toBe(false);
  expect(await callsReady({ calls: true }, withKey)).toBe(true);
});
