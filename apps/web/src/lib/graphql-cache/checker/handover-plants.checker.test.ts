/**
 * Proves the checker can fail: each test breaks the real code the way a bad
 * change could, and the checker must report a violation that is not a known
 * one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinatorCore } from '../worker/coordinator-core';
import { CacheCoordinatorPageAdapter } from '../worker/coordinator-page-adapter';
import { explains, explore, violationKey } from './explore';
import { KNOWN_VIOLATIONS } from './known-violations';
import { type FaultKind, usePlant } from './world';

vi.mock('../app-build', async () => {
  const { currentBuildTime } = await import('./world');
  return {
    get APP_BUILD_TIME() {
      return currentBuildTime();
    },
  };
});

afterEach(() => usePlant(undefined));

/** The violations found that no known one accounts for. */
async function newViolations(faults: FaultKind[]): Promise<string[]> {
  const { findings, truncated, cutShort } = await explore(
    { name: 'plant', pages: [1, 1], faults, horizonMs: 60_000 },
    { maxFaults: 1, maxDelays: 0, maxRuns: 5_000 }
  );
  expect({ truncated, cutShort }).toEqual({ truncated: false, cutShort: 0 });
  return findings
    .filter(
      (finding) => !KNOWN_VIOLATIONS.some((known) => explains(known, finding))
    )
    .map(violationKey);
}

describe('a known violation', () => {
  const key = (faults: string[], reordered = false) => ({
    symptom: 'S3',
    faults,
    reordered,
  });

  it('explains the same symptom under more faults', () => {
    expect(explains(key(['kill owner']), key(['hide', 'kill owner']))).toBe(
      true
    );
  });

  it('does not explain it when a fault hit another page, came fewer times, or needed no reordering', () => {
    expect(explains(key(['kill owner']), key(['close owner', 'kill']))).toBe(
      false
    );
    expect(explains(key(['fail-open', 'fail-open']), key(['fail-open']))).toBe(
      false
    );
    expect(explains(key(['close owner'], true), key(['close owner']))).toBe(
      false
    );
  });
});

describe('handover checker, on broken code', { timeout: 120_000 }, () => {
  it('reports nothing new when nothing is broken', async () => {
    expect(await newViolations(['hide', 'close', 'crash-engine'])).toEqual([]);
  });

  it('catches a closing tab taken for a crashed one', async () => {
    usePlant(() => {
      vi.spyOn(
        CoordinatorCore.prototype,
        'departForNavigation'
      ).mockImplementation(function (this: CoordinatorCore, tabId, epoch) {
        return this.ownerLost(tabId, epoch, 'owner crashed');
      });
    });
    expect(await newViolations(['close'])).toContain(
      'S3:queued write lost (database wiped) [close owner]'
    );
  });

  it('catches a lost engine nobody replaces', async () => {
    usePlant(() => {
      vi.spyOn(CoordinatorCore.prototype, 'resumeAfterLoss').mockReturnValue(
        []
      );
    });
    expect(await newViolations(['crash-engine'])).toContainEqual(
      expect.stringMatching(/^L2:no active engine \(resetting-after-loss\)/)
    );
  });

  it('catches an engine that outlives its host', async () => {
    usePlant(() => {
      vi.spyOn(
        CacheCoordinatorPageAdapter.prototype as unknown as {
          terminateEngine: () => boolean;
        },
        'terminateEngine'
      ).mockReturnValue(true);
    });
    expect(await newViolations(['expire-session'])).toContainEqual(
      expect.stringMatching(
        /^L2:no active engine \(.*\) \[expire-session owner\]$/
      )
    );
  });

  it('catches an engine whose answers are dropped', async () => {
    usePlant(() => {
      vi.spyOn(CoordinatorCore.prototype, 'engineResponse').mockReturnValue([]);
    });
    expect(await newViolations(['hide'])).toContain(
      'S2:host retired on CacheRequestTimeoutError:request-timeout [no fault]'
    );
  });
});
