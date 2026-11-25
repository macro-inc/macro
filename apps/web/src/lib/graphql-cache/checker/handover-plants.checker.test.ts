/**
 * Proves the checker can fail: each test breaks the real code the way a bad
 * change could, and the checker must report a violation that is not a known
 * one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoordinatorCore } from '../worker/coordinator-core';
import { CacheCoordinatorPageAdapter } from '../worker/coordinator-page-adapter';
import { explains, explore, violationKey } from './explore';
import { DurableStorage } from './fake-engine';
import { KNOWN_VIOLATIONS } from './known-violations';
import { Sim } from './sim';
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
async function newViolations(
  faults: FaultKind[],
  { pages = [1, 1], maxFaults = 1, horizonMs = 60_000 } = {}
): Promise<string[]> {
  const { findings, truncated, cutShort } = await explore(
    { name: 'plant', pages, faults, horizonMs },
    { maxFaults, maxDelays: 0, maxRuns: 5_000 }
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

describe('a state', () => {
  it('is told from one whose timers have longer to go', () => {
    const states = [0, 500].map((elapsed) => {
      const sim = new Sim();
      sim.setTimeout(() => {}, 1_000);
      sim.advanceTo(sim.now + elapsed);
      return sim.timerSummary();
    });
    expect(states[0]).not.toBe(states[1]);
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
      'S3:database wiped though no engine failed [close owner]'
    );
  });

  it('catches a wipe that does not copy the queue first', async () => {
    usePlant(() => {
      vi.spyOn(DurableStorage.prototype, 'salvage').mockReturnValue();
    });
    expect(await newViolations(['crash-engine'])).toContain(
      'S3:queued write lost (database wiped) [crash-engine owner]'
    );
  });

  it('catches a queue that could not be read and is called whole', async () => {
    usePlant(() => {
      const restore = DurableStorage.prototype.restore;
      vi.spyOn(DurableStorage.prototype, 'restore').mockImplementation(
        function (this: DurableStorage, scope, wiped) {
          restore.call(this, scope, wiped);
          return 'preserved';
        }
      );
    });
    expect(
      await newViolations(['corrupt-database', 'crash-engine'], {
        pages: [1],
        maxFaults: 2,
        horizonMs: 15_000,
      })
    ).toContain(
      'S3:queued write lost and its page not told [corrupt-database+crash-engine owner]'
    );
  });

  it('catches a page that is not told its queue was lost', async () => {
    usePlant(() => {
      const ready = CoordinatorCore.prototype.engineReady;
      vi.spyOn(CoordinatorCore.prototype, 'engineReady').mockImplementation(
        function (this: CoordinatorCore, proof) {
          return ready.call(this, { ...proof, queue: 'preserved' });
        }
      );
    });
    expect(
      await newViolations(['corrupt-database', 'crash-engine'], {
        pages: [1],
        maxFaults: 2,
        horizonMs: 15_000,
      })
    ).toContain(
      'S3:queued write lost and its page not told [corrupt-database+crash-engine owner]'
    );
  });

  it('catches pages told of a loss there was not', async () => {
    usePlant(() => {
      const ready = CoordinatorCore.prototype.engineReady;
      vi.spyOn(CoordinatorCore.prototype, 'engineReady').mockImplementation(
        function (this: CoordinatorCore, proof) {
          return ready.call(this, { ...proof, queue: 'reset' });
        }
      );
    });
    expect(await newViolations(['crash-engine'])).toContain(
      'S3:told the queue was lost, which was kept [crash-engine owner]'
    );
  });

  it('catches a copy that only lives until the engine that made it ends', async () => {
    usePlant(() => {
      const copy = vi.spyOn(DurableStorage.prototype, 'salvage');
      copy.mockImplementation(function (this: DurableStorage, scope) {
        const database = this.database(scope);
        database.salvaged = new Map(database.queue);
      });
    });
    expect(
      await newViolations(['crash-engine'], { pages: [1], maxFaults: 2 })
    ).toContain('S3:queued write lost (database wiped) [crash-engine owner×2]');
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

  it('catches a cache that answers reads and refuses drafts', async () => {
    const request = CoordinatorCore.prototype.request;
    usePlant(() => {
      vi.spyOn(CoordinatorCore.prototype, 'request').mockImplementation(
        function (this: CoordinatorCore, tabId, sent) {
          if (sent.kind !== 'enqueue-optimistic-mutation')
            return request.call(this, tabId, sent);
          return [
            {
              kind: 'reject-request',
              tabId,
              requestId: sent.id,
              error: 'refused',
              errorCode: 'owner-handoff-blocked',
            },
          ];
        }
      );
    });
    expect(await newViolations(['hide'])).toContain(
      'L1:cache not back (ready, probe draft CacheResponseError:owner-handoff-blocked) [no fault]'
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
