import { expect, test } from 'vitest';
import { CaptureLeases } from './capture-leases';
import {
  VersionCollector,
  type VersionCollectorEvent,
} from './version-collector';

test('protected versions stay queued without native work or polling', () => {
  const jobs: (() => void)[] = [];
  const events: VersionCollectorEvent[] = [];
  let live = false,
    released = 0;
  const collector = new VersionCollector(
    {
      canCollect: () => false,
      flushLeases: () => {
        throw new Error('Unexpected native lease work');
      },
      releaseVersion: () => {
        throw new Error('Unexpected native retirement');
      },
      scheduleDrain: (job) => jobs.push(job),
    },
    (event) => events.push(event)
  );
  collector.collect(
    1n,
    () => !live,
    () => released++
  );
  collector.collect(
    1n,
    () => !live,
    () => released++
  );
  expect(jobs).toHaveLength(1);
  const job = jobs.shift();
  if (!job) throw new Error('Missing scheduled collection');
  job();
  expect(collector.drain()).toBe(false);
  expect(jobs).toHaveLength(0);
  expect(events.some((event) => event.kind === 'release-start')).toBe(false);
  live = true;
  expect(collector.drain()).toBe(true);
  expect(released).toBe(0);
  expect(events.at(-1)?.kind).toBe('cancelled');
});

test('failed lease flush keeps the finalizer request and never fabricates a release ack', () => {
  const failure = new Error('Native lease submission rejected');
  const events: VersionCollectorEvent[] = [];
  let flushes = 0,
    released = 0;
  const collector = new VersionCollector(
    {
      canCollect: () => true,
      flushLeases: () => {
        flushes++;
        throw failure;
      },
      releaseVersion: () => {
        throw new Error('Unexpected native retirement');
      },
      scheduleDrain: () => {},
    },
    (event) => events.push(event)
  );
  collector.collect(
    1n,
    () => true,
    () => released++
  );
  expect(() => collector.drain()).toThrow(failure);
  expect(() => collector.drain()).toThrow(failure);
  expect(flushes).toBe(2);
  expect(released).toBe(0);
  expect(
    events.some(
      (event) =>
        event.kind === 'lease-flush-ack' || event.kind === 'release-ack'
    )
  ).toBe(false);
  expect(events.filter((event) => event.kind === 'failure')).toHaveLength(2);
});

test('reentrant collections and replacement ownership survive a failed flush', () => {
  let live = false,
    released = 0,
    collecting = false;
  const events: VersionCollectorEvent[] = [];
  let collector: VersionCollector;
  collector = new VersionCollector(
    {
      canCollect: (version) => version === 1n,
      flushLeases: () => {
        expect(collector.drain()).toBe(false);
        live = true;
        if (!collecting) {
          collecting = true;
          collector.collect(
            2n,
            () => true,
            () => released++
          );
        }
        throw new Error('Rejected before lease acknowledgement');
      },
      releaseVersion: () => {
        throw new Error('Unexpected native retirement');
      },
      scheduleDrain: () => {},
    },
    (event) => events.push(event)
  );
  collector.collect(
    1n,
    () => !live,
    () => released++
  );
  expect(() => collector.drain()).toThrow(
    'Rejected before lease acknowledgement'
  );
  expect(collector.drain()).toBe(false);
  expect(released).toBe(0);
  expect(
    events.some((event) => event.kind === 'cancelled' && event.version === 1n)
  ).toBe(true);
  expect(
    events.some((event) => event.kind === 'blocked' && event.version === 2n)
  ).toBe(true);
});

test('disposal cancels queued JS work without synthetic native acknowledgement', () => {
  const jobs: (() => void)[] = [];
  let released = 0;
  const collector = new VersionCollector({
    canCollect: () => {
      throw new Error('Disposed collector queried guards');
    },
    flushLeases: () => {
      throw new Error('Disposed collector flushed');
    },
    releaseVersion: () => {
      throw new Error('Disposed collector retired');
    },
    scheduleDrain: (job) => jobs.push(job),
  });
  collector.collect(
    1n,
    () => true,
    () => released++
  );
  collector.dispose();
  collector.dispose();
  collector.collect(
    2n,
    () => true,
    () => released++
  );
  const job = jobs.shift();
  if (!job) throw new Error('Missing scheduled collection');
  job();
  expect(collector.drain()).toBe(false);
  expect(released).toBe(0);
  expect(jobs).toHaveLength(0);
});

test('observer cannot mutate the collector and event sequences preserve actual transitions', () => {
  const events: VersionCollectorEvent[] = [];
  let collector: VersionCollector;
  collector = new VersionCollector(
    {
      canCollect: () => false,
      flushLeases: () => {
        throw new Error('Unexpected flush');
      },
      releaseVersion: () => {
        throw new Error('Unexpected retirement');
      },
      scheduleDrain: () => {},
    },
    (event) => {
      events.push(event);
      expect(() =>
        collector.collect(
          2n,
          () => true,
          () => {}
        )
      ).toThrow('must not reenter');
      expect(() => collector.drain()).toThrow('must not reenter');
      expect(() => collector.dispose()).toThrow('must not reenter');
    }
  );
  collector.collect(
    1n,
    () => true,
    () => {}
  );
  expect(collector.drain()).toBe(false);
  collector.dispose();
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  expect(events.map((event) => event.kind)).toEqual([
    'queued',
    'blocked',
    'disposed',
  ]);
});

test('invalid versions never reach the scheduler or native boundary', () => {
  const collector = new VersionCollector({
    canCollect: () => {
      throw new Error('Unexpected guard');
    },
    flushLeases: () => {
      throw new Error('Unexpected flush');
    },
    releaseVersion: () => {
      throw new Error('Unexpected retirement');
    },
    scheduleDrain: () => {
      throw new Error('Unexpected scheduling');
    },
  });
  expect(() =>
    collector.collect(
      -1n,
      () => true,
      () => {}
    )
  ).toThrow('native uint64');
  expect(() =>
    collector.collect(
      0x10000000000000000n,
      () => true,
      () => {}
    )
  ).toThrow('native uint64');
  expect(collector.drain()).toBe(true);
});

test('an actually empty lease queue permits the final liveness recheck without a native ack', () => {
  const leases = new CaptureLeases(1);
  let live = false,
    released = 0;
  const collector = new VersionCollector({
    canCollect: () => true,
    flushLeases: () => {
      expect(leases.beginDrain()).toBeUndefined();
      live = true;
    },
    releaseVersion: () => {
      throw new Error('Live version must not retire');
    },
    scheduleDrain: () => {},
  });
  collector.collect(
    1n,
    () => !live,
    () => released++
  );
  expect(collector.drain()).toBe(true);
  expect(released).toBe(0);
});

test('failed retirement preserves both original and reentered requests without any ack', () => {
  const leases = new CaptureLeases(1);
  const failure = new Error('Native release rejected before acknowledgement');
  let live = false,
    released = 0,
    calls = 0;
  let collector: VersionCollector;
  collector = new VersionCollector({
    canCollect: () => true,
    flushLeases: () => {
      expect(leases.beginDrain()).toBeUndefined();
    },
    releaseVersion: () => {
      calls++;
      collector.collect(
        1n,
        () => !live,
        () => released++
      );
      throw failure;
    },
    scheduleDrain: () => {},
  });
  collector.collect(
    1n,
    () => !live,
    () => released++
  );
  expect(() => collector.drain()).toThrow(failure);
  expect(() => collector.drain()).toThrow(failure);
  expect(calls).toBe(2);
  expect(released).toBe(0);
  live = true;
  expect(collector.drain()).toBe(true);
  expect(released).toBe(0);
});
