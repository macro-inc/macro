/**
 * What the checker finds on main today, each with the defect that causes it.
 * A fix removes its entries: the checker fails on a violation that is not
 * listed, and on a listed one it no longer finds.
 */
import type { ViolationKey } from './explore';
import type { FaultKind } from './world';

export type KnownViolation = ViolationKey & {
  /** The defect that causes it. */
  cause: string;
  /** Found only by the deep scenarios. */
  deep?: boolean;
};

const WIPE =
  'The open after an owner died without closing storage wipes the database, queued writes included.';
const DEPARTURE_RACE =
  "A closing owner's liveness lock can be handed on before its departure message arrives, so it counts as crashed and its database is wiped.";
const STARTUP_LOSS =
  "An owner lost while a tab's startup handshake is pending fails the handshake. The page drops a host that was waiting for the next owner, and recovery calls the error unrecoverable and stops until reload.";
const DISPOSE_QUARANTINE =
  'Disposing a host that is not ready quarantines its scope, so its queued writes are left behind in the old database.';
const RESTART_AT_STARTUP =
  'A coordinator restart during startup drops a host that could re-register.';
const BFCACHE_AT_STARTUP =
  'A tab that enters the back/forward cache while starting drops its host, and nothing restarts it when the tab comes back.';
const UNCODED_DISPOSE =
  'A disposed host refuses its requests with errors that carry no code.';
const SUPERSEDED_AT_STARTUP =
  'A tab refused at startup because a newer build took over is never told to reload.';
const DRAIN_UNBOUNDED =
  'A frozen owner never finishes its drain, and nothing bounds how long the handover waits for it.';
const OPEN_ATTEMPTS =
  'Five failed opens in a row stop the coordinator for every tab until reload.';

const known = (
  cause: string,
  faults: FaultKind[],
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
const ABANDONED = 'S3:queued write lost (scope changed)';
const EPOCH_LOST = 'S2:host retired on CacheResponseError:owner-epoch-lost';
const STOPPED =
  'L1:cache not back (recovery-required, stopped unrecoverable, probe read not made)';
const UNSERVED = 'L2:no active engine (waiting-for-tab)';
const READ_DISPOSED =
  'S5:read refused without a code: Error:untyped:cache worker host was abruptly disposed';
const OPEN_FAILED =
  'Error:untyped:cache recovery failed after 5 attempts: storage error: unable to open database file';

const OWNER_LOST: FaultKind[] = ['close', 'kill', 'bfcache', 'crash-engine'];

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  ...known(WIPE, ['crash-engine'], [WIPED]),
  ...known(WIPE, ['kill'], [WIPED]),
  ...known(DEPARTURE_RACE, ['close'], [WIPED], { reordered: true }),
  ...OWNER_LOST.flatMap((fault) => [
    ...known(STARTUP_LOSS, [fault], [EPOCH_LOST, STOPPED, UNSERVED]),
    ...known(STARTUP_LOSS, [fault], [READ_DISPOSED]),
    ...known(DISPOSE_QUARANTINE, [fault], [ABANDONED]),
  ]),
  ...known(STARTUP_LOSS, ['replace-client'], [EPOCH_LOST, STOPPED]),
  ...known(
    RESTART_AT_STARTUP,
    ['restart-coordinator'],
    ['S2:host retired on CoordinatorRestartedError:owner-epoch-lost']
  ),
  ...known(
    BFCACHE_AT_STARTUP,
    ['bfcache'],
    [
      'S2:host retired on CacheNavigationError:untyped:cache worker host was disposed for page navigation',
    ]
  ),
  ...known(
    BFCACHE_AT_STARTUP,
    ['bfcache', 'restore'],
    ['L2:no active engine (none)']
  ),
  ...known(
    UNCODED_DISPOSE,
    ['replace-client'],
    [
      READ_DISPOSED,
      'S5:draft refused without a code: Error:untyped:cache worker host was abruptly disposed',
      'S5:read refused without a code: Error:untyped:cache worker host was disposed during startup',
      'S5:draft refused without a code: Error:untyped:cache worker host was disposed during startup',
    ]
  ),
  ...known(
    SUPERSEDED_AT_STARTUP,
    ['open-newer'],
    [
      'L1:cache not back (recovery-required, stopped superseded, probe read not made)',
    ]
  ),
  ...known(
    DRAIN_UNBOUNDED,
    ['freeze', 'hide'],
    [
      'L1:cache not back (ready, probe read CacheResponseError:owner-handoff-blocked)',
      'L2:no active engine (draining)',
    ]
  ),
  ...known(
    OPEN_ATTEMPTS,
    ['fail-open'],
    [
      `S2:host retired on ${OPEN_FAILED}`,
      `S5:draft refused without a code: ${OPEN_FAILED}`,
      `S5:read refused without a code: ${OPEN_FAILED}`,
      STOPPED,
      'L2:no active engine (failed)',
    ]
  ),
];
