/**
 * The proxy refusal inside the runner and the server, not only in the
 * command. `all_proxy` stands in for every proxy variable: Bun's own fetch
 * does not read it, so setting it here leaves other tests' requests alone.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mockPlanner } from '../src/planner.ts';
import { LAB_URL } from '../src/registry.ts';
import { runChallenge } from '../src/run.ts';
import { createLab, serveLab } from '../src/server.ts';

beforeEach(() => {
  process.env.all_proxy = 'http://127.0.0.1:47853';
});

afterEach(() => {
  delete process.env.all_proxy;
});

test('the runner refuses a proxy-configured run before any browser or planner', async () => {
  const lab = createLab();
  let plannerCalls = 0;
  const planner = mockPlanner(() => {
    plannerCalls += 1;
    return { kind: 'choice', label: 'A' };
  });
  const sessionNonce = crypto.randomUUID();
  const issued = lab.issue('relation', sessionNonce);

  const record = await runChallenge({
    lab,
    planner,
    family: 'relation',
    ...issued,
    sessionNonce,
    targetUrl: LAB_URL,
    executablePath: '/nonexistent/chromium',
  });

  expect(record.outcome).toBe('provenance_rejected');
  expect(record.detail).toBe('proxy_configured');
  expect(record.plannerCalls).toBe(0);
  expect(record.actions).toHaveLength(0);
  expect(plannerCalls).toBe(0);
  expect(lab.stats().pageLoads).toBe(0);
});

test('the lab server refuses to start with a proxy configured', () => {
  expect(() => serveLab(createLab().fetch)).toThrow('proxy');
});
