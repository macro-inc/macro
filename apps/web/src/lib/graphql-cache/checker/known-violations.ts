/**
 * What the checker finds on main today, each with the defect that causes it.
 * A fix removes its entries: the checker fails on a violation that is not
 * listed, and on a listed one it no longer finds.
 */
import type { ViolationKey } from './explore';
import type { InjectedFault } from './world';

export type KnownViolation = ViolationKey & {
  /** The defect that causes it. */
  cause: string;
  /** Found only by the deep scenarios. */
  deep?: boolean;
};

const WIPE =
  'The open after an engine died in a live page wipes the database, queued writes included.';
const SUPERSEDED_AT_STARTUP =
  'A tab refused at startup because a newer build has the database is never told to reload.';
const HOLDER_KEPT =
  'A tab refused the database because a tab of another build keeps it turns its cache off until reload, however long it waits.';
const LOCK_TIMEOUT =
  'A coordinator that cannot get the database lock within its retries turns the cache off in its tabs until reload.';
const FILES_BUSY =
  "A coordinator whose database files another context keeps open past the engine's wait turns the cache off in its tabs.";
const STARTUP_TIMEOUT =
  'A startup request that outlives its timer drops a host that could still start, and recovery calls the timeout unrecoverable and stops until reload.';
const UNCODED_TIMEOUT = 'A request that times out is refused without a code.';
const DRAIN_UNBOUNDED =
  'A frozen owner never finishes its drain, and nothing bounds how long the handover waits for it.';
const OPEN_ATTEMPTS =
  'Six failed opens in a row stop the coordinator for every tab until reload.';

const known = (
  cause: string,
  faults: InjectedFault[],
  symptoms: string[],
  rest: { reordered?: boolean; deep?: boolean } = {}
): KnownViolation[] =>
  symptoms.map((symptom) => ({
    symptom,
    faults: [...faults].sort(),
    reordered: rest.reordered ?? false,
    cause,
    ...(rest.deep ? { deep: true } : {}),
  }));

const WIPED = 'S3:queued write lost (database wiped)';
const STOPPED =
  'L1:cache not back (recovery-required, stopped unrecoverable, probe read not made)';
const UNSERVED = 'L2:no active engine (waiting-for-tab)';
const UNSTARTED = 'L2:no active engine (no coordinator)';
const PARKED = 'L2:no active engine (parked)';
const OPEN_FAILED =
  'Error:untyped:cache recovery failed after 5 attempts: storage error: unable to open database file';

const HOLDER_KEPT_RETIRED =
  'S2:host retired on CacheUnavailableError:owner-lock-unavailable:holder-kept';
const UNAVAILABLE = 'L1:cache not back (unavailable, probe read not made)';
const timeout = (request: string): string =>
  `Error:untyped:cache worker timeout: ${request}`;

/** Faults that make a tab ask for the database a tab of another build has. */
const CONTENDING: InjectedFault[] = [
  'open-newer',
  'hide',
  'expire-session',
  'expire-session owner',
  'crash-engine owner',
  'restart-coordinator',
  'hold-files',
];

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  ...known(WIPE, ['crash-engine owner'], [WIPED]),
  ...known(
    SUPERSEDED_AT_STARTUP,
    [],
    [
      'L1:cache not back (recovery-required, stopped superseded, probe read not made)',
    ]
  ),
  ...(['close owner', 'kill owner', 'bfcache owner'] as const).flatMap(
    (fault) => known(SUPERSEDED_AT_STARTUP, [fault], [UNSERVED])
  ),
  ...known(
    FILES_BUSY,
    ['hold-files'],
    [
      'S2:host retired on CacheUnavailableError:owner-lock-unavailable:files-busy',
    ]
  ),
  ...CONTENDING.flatMap((fault) =>
    known(HOLDER_KEPT, [fault], [HOLDER_KEPT_RETIRED, UNAVAILABLE])
  ),
  ...(['open-newer', 'hold-files'] as const).flatMap((fault) =>
    known(
      LOCK_TIMEOUT,
      [fault],
      [
        'S2:host retired on CacheUnavailableError:owner-lock-unavailable:owner-lock-timeout',
      ]
    )
  ),
  ...known(
    STARTUP_TIMEOUT,
    ['late-message'],
    [
      `S2:host retired on ${timeout('current-authority')}`,
      `S2:host retired on ${timeout('init')}`,
      STOPPED,
      UNSERVED,
    ]
  ),
  ...(['hide', 'hide owner'] as const).flatMap((fault) =>
    known(STARTUP_TIMEOUT, [fault, 'late-message'], [PARKED], { deep: true })
  ),
  ...known(
    UNCODED_TIMEOUT,
    ['late-message'],
    [
      `S5:read refused without a code: ${timeout('read')}`,
      ...(['read', 'draft'] as const).flatMap((kind) => [
        `S5:${kind} refused without a code: ${timeout('init')}`,
        `S5:${kind} refused without a code: ${timeout('current-authority')}`,
      ]),
    ]
  ),
  ...known(
    DRAIN_UNBOUNDED,
    ['freeze owner', 'hide owner'],
    [
      'L1:cache not back (ready, probe read CacheResponseError:owner-handoff-blocked)',
      'L2:no active engine (draining)',
      'L3:draft never settled',
    ]
  ),
  ...known(
    OPEN_ATTEMPTS,
    Array.from({ length: 6 }, () => 'fail-open' as const),
    [
      `S2:host retired on ${OPEN_FAILED}`,
      `S5:draft refused without a code: ${OPEN_FAILED}`,
      `S5:read refused without a code: ${OPEN_FAILED}`,
      STOPPED,
      UNSTARTED,
    ]
  ),
];
