import {
  CompatHoldFailure,
  CompatHoldReleaseOutcome,
  CompatHoldReleaseReply,
  CompatPublicationHold,
  ForeignOpaqueValue,
  type ICompatHoldReleaseRequest,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { describe, expect, it } from 'vitest';
import { PublicationHoldDriver, type PublicationHoldPorts } from './hold';

describe('publication hold acknowledgement component (not native acceptance)', () => {
  it('acknowledges None without clocks, native release or publication draining', () => {
    const events: string[] = [];
    const driver = new PublicationHoldDriver({
      runRelease: () => {
        throw new Error('unexpected release');
      },
      clocks: {
        now: () => {
          throw new Error('unexpected clock');
        },
        wall: () => {
          throw new Error('unexpected wall');
        },
      },
      consumeFlags: () => {
        throw new Error('unexpected flags');
      },
      drainPublicationsAndAcknowledge: () => {
        throw new Error('unexpected drain');
      },
      decodeFailure: () => {
        throw new Error('unexpected failure');
      },
    });
    driver.acknowledge(
      CompatPublicationHold.fromCompatPublicationHoldNone({}),
      () => {
        events.push('local');
      }
    );
    expect(events).toEqual(['local']);
    expect(driver.diagnostic.phase).toBe('idle');
  });

  it('samples fresh clocks only after local acknowledgement and drains after actual flags', () => {
    const events: string[] = [];
    const requests: ICompatHoldReleaseRequest[] = [];
    let now = 10;
    const driver = new PublicationHoldDriver({
      runRelease: (request) => {
        requests.push(request);
        events.push('release');
        return CompatHoldReleaseReply.decode(
          CompatHoldReleaseReply.encode({
            flags: 5,
            outcome: CompatHoldReleaseOutcome.fromCompatHoldClosed({}),
          })
        );
      },
      clocks: {
        now: () => {
          events.push('now');
          return now;
        },
        wall: () => {
          events.push('wall');
          return 9000;
        },
      },
      consumeFlags: (flags) => {
        events.push(`flags:${flags}`);
      },
      drainPublicationsAndAcknowledge: () => {
        events.push('publications');
      },
      decodeFailure: () => {
        throw new Error('unexpected failure');
      },
    });
    driver.acknowledge(
      CompatPublicationHold.fromCompatPublicationHoldDeferred({ ticketId: 9n }),
      () => {
        expect(driver.diagnostic.ticketId).toBeUndefined();
        expect(driver.diagnostic.disposition?.data.discriminator).toBe(2);
        events.push('local');
        now = 6000;
      }
    );
    expect(requests).toEqual([{ ticketId: 9n, now: 6000, wall: 9000 }]);
    expect(events).toEqual([
      'local',
      'now',
      'wall',
      'release',
      'flags:5',
      'publications',
    ]);
    expect(driver.diagnostic.phase).toBe('idle');
  });

  it('blocks a partially failed local acknowledgement without acquiring release-ready authority', () => {
    const cause = { opaque: 'local' };
    let releases = 0;
    let acknowledgements = 0;
    const ports: PublicationHoldPorts = {
      runRelease: () => {
        releases++;
        return {
          flags: 0,
          outcome: CompatHoldReleaseOutcome.fromCompatHoldClosed({}),
        };
      },
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {},
      drainPublicationsAndAcknowledge: () => {},
      decodeFailure: () => cause,
    };
    const driver = new PublicationHoldDriver(ports);
    const disposition = CompatPublicationHold.fromCompatPublicationHoldDeferred(
      { ticketId: 2n }
    );
    expect(() =>
      driver.acknowledge(disposition, () => {
        acknowledgements++;
        throw cause;
      })
    ).toThrow(cause);
    expect(driver.diagnostic.phase).toBe('blocked');
    expect(driver.diagnostic.ticketId).toBeUndefined();
    expect(driver.diagnostic.disposition).toBe(disposition);
    expect(() => driver.resume()).toThrow();
    expect(() =>
      driver.acknowledge(disposition, () => {
        acknowledgements++;
      })
    ).toThrow();
    expect(acknowledgements).toBe(1);
    expect(releases).toBe(0);
  });

  it('never retries an unknown native transport result', () => {
    const cause = { opaque: 'transport' };
    let releases = 0;
    const driver = new PublicationHoldDriver({
      runRelease: () => {
        releases++;
        throw cause;
      },
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {},
      drainPublicationsAndAcknowledge: () => {},
      decodeFailure: () => cause,
    });
    expect(() =>
      driver.acknowledge(
        CompatPublicationHold.fromCompatPublicationHoldDeferred({
          ticketId: 2n,
        }),
        () => {}
      )
    ).toThrow(cause);
    expect(driver.diagnostic.cause).toBe(cause);
    expect(driver.diagnostic.phase).toBe('blocked');
    expect(() => driver.resume()).toThrow();
    expect(releases).toBe(1);
  });

  it('resumes only unfinished drain work after a known reply, never local ack/release/flags', () => {
    const events: string[] = [];
    const drainError = new Error('receipt acknowledgement interrupted');
    let nextReceipt = 0;
    let interrupted = false;
    const driver = new PublicationHoldDriver({
      runRelease: () => {
        events.push('release');
        return {
          flags: 3,
          outcome: CompatHoldReleaseOutcome.fromCompatHoldClosed({}),
        };
      },
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: (flags) => {
        events.push(`flags:${flags}`);
      },
      drainPublicationsAndAcknowledge: () => {
        while (nextReceipt < 2) {
          if (nextReceipt === 1 && !interrupted) {
            interrupted = true;
            throw drainError;
          }
          events.push(`receipt:${nextReceipt}`);
          nextReceipt++;
        }
      },
      decodeFailure: () => {
        throw new Error('unexpected failure');
      },
    });
    expect(() =>
      driver.acknowledge(
        CompatPublicationHold.fromCompatPublicationHoldDeferred({
          ticketId: 2n,
        }),
        () => {
          events.push('local');
        }
      )
    ).toThrow(drainError);
    expect(driver.diagnostic.phase).toBe('draining');
    driver.resume();
    expect(events).toEqual([
      'local',
      'release',
      'flags:3',
      'receipt:0',
      'receipt:1',
    ]);
    expect(driver.diagnostic.phase).toBe('idle');
  });

  it('drains actual receipts before surfacing the exact opaque deferred cause and remains blocked', () => {
    const cause = { original: true };
    const events: string[] = [];
    const driver = new PublicationHoldDriver({
      runRelease: () => ({
        flags: 1,
        outcome: CompatHoldReleaseOutcome.fromCompatHoldDeferredFailure({
          failure: CompatHoldFailure.fromCompatHoldHostFailure({
            hostSlot: 5,
            error: ForeignOpaqueValue.fromForeignSlot({ slotId: 7 }),
          }),
        }),
      }),
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {
        events.push('flags');
      },
      drainPublicationsAndAcknowledge: () => {
        events.push('receipt');
      },
      decodeFailure: (failure) => {
        events.push('failure');
        expect(failure.data.discriminator).toBe(2);
        return cause;
      },
    });
    expect(() =>
      driver.acknowledge(
        CompatPublicationHold.fromCompatPublicationHoldDeferred({
          ticketId: 2n,
        }),
        () => {
          events.push('local');
        }
      )
    ).toThrow(cause);
    expect(events).toEqual(['local', 'flags', 'receipt', 'failure']);
    expect(driver.diagnostic.phase).toBe('blocked');
    expect(driver.diagnostic.cause).toBe(cause);
    expect(() => driver.resume()).toThrow();
  });

  it('closes CompositionHeld without spinning while native composition owns the debt', () => {
    let releases = 0;
    const driver = new PublicationHoldDriver({
      runRelease: () => {
        releases++;
        return {
          flags: 0,
          outcome: CompatHoldReleaseOutcome.fromCompatHoldCompositionHeld({}),
        };
      },
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {},
      drainPublicationsAndAcknowledge: () => {},
      decodeFailure: () => undefined,
    });
    driver.acknowledge(
      CompatPublicationHold.fromCompatPublicationHoldDeferred({ ticketId: 2n }),
      () => {}
    );
    expect(driver.diagnostic.phase).toBe('idle');
    expect(releases).toBe(1);
    expect(() => driver.resume()).toThrow();
  });

  it('blocks partial flag application instead of replaying it or allowing drain resumption', () => {
    const cause = new Error('partial effects');
    let flags = 0;
    const driver = new PublicationHoldDriver({
      runRelease: () => ({
        flags: 3,
        outcome: CompatHoldReleaseOutcome.fromCompatHoldClosed({}),
      }),
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {
        flags++;
        throw cause;
      },
      drainPublicationsAndAcknowledge: () => {
        throw new Error('unexpected drain');
      },
      decodeFailure: () => undefined,
    });
    expect(() =>
      driver.acknowledge(
        CompatPublicationHold.fromCompatPublicationHoldDeferred({
          ticketId: 2n,
        }),
        () => {}
      )
    ).toThrow(cause);
    expect(() => driver.resume()).toThrow();
    expect(flags).toBe(1);
  });
});

it('preserves thrown undefined and null after deferred publication acknowledgement', () => {
  for (const cause of [undefined, null]) {
    let drained = false;
    let threw = false;
    const driver = new PublicationHoldDriver({
      runRelease: () => ({
        flags: 0,
        outcome: CompatHoldReleaseOutcome.fromCompatHoldDeferredFailure({
          failure: CompatHoldFailure.fromCompatHoldHostFailure({
            hostSlot: 5,
            error:
              cause === null
                ? ForeignOpaqueValue.fromForeignNull({})
                : ForeignOpaqueValue.fromForeignUndefined({}),
          }),
        }),
      }),
      clocks: { now: () => 1, wall: () => 2 },
      consumeFlags: () => {},
      drainPublicationsAndAcknowledge: () => {
        drained = true;
      },
      decodeFailure: () => cause,
    });
    try {
      driver.acknowledge(
        CompatPublicationHold.fromCompatPublicationHoldDeferred({
          ticketId: 2n,
        }),
        () => {}
      );
    } catch (error) {
      threw = true;
      expect(error).toBe(cause);
    }
    expect(threw).toBe(true);
    expect(drained).toBe(true);
    expect(driver.diagnostic.phase).toBe('blocked');
  }
});

it('rejects recursive resume while an actual publication drain is executing', () => {
  let releases = 0;
  const driver = new PublicationHoldDriver({
    runRelease: () => {
      releases++;
      return {
        flags: 0,
        outcome: CompatHoldReleaseOutcome.fromCompatHoldClosed({}),
      };
    },
    clocks: { now: () => 1, wall: () => 2 },
    consumeFlags: () => {},
    drainPublicationsAndAcknowledge: () => {
      expect(() => driver.resume()).toThrow();
    },
    decodeFailure: () => undefined,
  });
  driver.acknowledge(
    CompatPublicationHold.fromCompatPublicationHoldDeferred({ ticketId: 2n }),
    () => {}
  );
  expect(driver.diagnostic.phase).toBe('idle');
  expect(releases).toBe(1);
});

it('retains an interrupted drain before exposing a known native failure on resume', () => {
  const cause = { original: 'native host value' };
  let interrupted = false;
  let decodes = 0;
  let releases = 0;
  const driver = new PublicationHoldDriver({
    runRelease: () => {
      releases++;
      return {
        flags: 0,
        outcome: CompatHoldReleaseOutcome.fromCompatHoldDeferredFailure({
          failure: CompatHoldFailure.fromCompatHoldHostFailure({
            hostSlot: 5,
            error: ForeignOpaqueValue.fromForeignSlot({ slotId: 9 }),
          }),
        }),
      };
    },
    clocks: { now: () => 1, wall: () => 2 },
    consumeFlags: () => {},
    drainPublicationsAndAcknowledge: () => {
      if (!interrupted) {
        interrupted = true;
        throw new Error('drain interrupted');
      }
    },
    decodeFailure: () => {
      decodes++;
      return cause;
    },
  });
  expect(() =>
    driver.acknowledge(
      CompatPublicationHold.fromCompatPublicationHoldDeferred({ ticketId: 2n }),
      () => {}
    )
  ).toThrow('drain interrupted');
  expect(decodes).toBe(0);
  expect(driver.diagnostic.phase).toBe('draining');
  expect(() => driver.resume()).toThrow(cause);
  expect(decodes).toBe(1);
  expect(releases).toBe(1);
  expect(driver.diagnostic.phase).toBe('blocked');
});
