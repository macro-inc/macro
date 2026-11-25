import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  driverOf,
  driverPorts,
  ownerDriving,
  refusal,
  staleLeaseMs,
} from '../driver.ts';

describe('ownerDriving', () => {
  test("the harness's take-over file says human, with or without an id", () => {
    expect(ownerDriving('human\n')).toBe(true);
    expect(ownerDriving('human:7d2c4f50-0000-4000-8000-000000000001\n')).toBe(
      true
    );
    expect(ownerDriving('humane')).toBe(false);
    expect(ownerDriving(undefined)).toBe(false);
  });
});

describe('driverOf', () => {
  test("the owner's take-over beats a solver's lease", () => {
    expect(
      driverOf(
        'human:7d2c4f50-0000-4000-8000-000000000001\n',
        JSON.stringify({ solveId: 'solve-1', since: 1_000 }),
        2_000
      )
    ).toEqual({ kind: 'owner' });
  });

  test('a live lease is the solver; a stale or unreadable one is nobody', () => {
    expect(
      driverOf(
        undefined,
        JSON.stringify({ solveId: 'solve-1', since: 1_000 }),
        2_000
      )
    ).toEqual({ kind: 'solver', solveId: 'solve-1' });
    expect(
      driverOf(
        undefined,
        JSON.stringify({ solveId: 'solve-1', since: 1_000 }),
        1_000 + staleLeaseMs + 1
      )
    ).toEqual({ kind: 'agent' });
    expect(driverOf(undefined, 'not json', 2_000)).toEqual({ kind: 'agent' });
    expect(driverOf('', undefined, 2_000)).toEqual({ kind: 'agent' });
  });

  test('browser steps refuse while anyone else drives', () => {
    expect(refusal({ kind: 'agent' })).toBeUndefined();
    expect(refusal({ kind: 'owner' })).toBe(
      'your owner is driving your screen: wait until they hand it back'
    );
    expect(refusal({ kind: 'solver', solveId: 'solve-1' })).toBe(
      'the CAPTCHA solver is using your browser: wait for solveCaptcha to finish'
    );
  });
});

describe('driverPorts', () => {
  let directory = '';
  let now = 10_000;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'driver-'));
    now = 10_000;
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const ports = () =>
    driverPorts({
      advisory: join(directory, 'screen-driver'),
      lease: join(directory, 'run', 'solver-lease.json'),
      now: () => now,
    });

  test('one solve holds the lease at a time, and only it gives it back', async () => {
    const driving = ports();
    expect(await driving.acquire('solve-1')).toBe(true);
    expect(await driving.acquire('solve-2')).toBe(false);
    await driving.release('solve-2');
    expect(await driving.driver()).toEqual({
      kind: 'solver',
      solveId: 'solve-1',
    });
    await driving.release('solve-1');
    expect(await driving.driver()).toEqual({ kind: 'agent' });
    expect(await driving.acquire('solve-2')).toBe(true);
  });

  test("a dead solve's lease is taken over", async () => {
    const driving = ports();
    expect(await driving.acquire('solve-1')).toBe(true);
    now += staleLeaseMs + 1;
    expect(await driving.acquire('solve-2')).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(directory, 'run', 'solver-lease.json'), 'utf8')
      )
    ).toEqual({ solveId: 'solve-2', since: now });
  });

  test('no lease while the owner drives', async () => {
    await writeFile(
      join(directory, 'screen-driver'),
      'human:7d2c4f50-0000-4000-8000-000000000001\n'
    );
    const driving = ports();
    expect(await driving.acquire('solve-1')).toBe(false);
    expect(await driving.driver()).toEqual({ kind: 'owner' });
  });
});
