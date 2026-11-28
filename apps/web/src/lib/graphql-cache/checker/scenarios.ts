/**
 * The scenarios the checker explores, each with its bound, and the fixed
 * fault sequences for defects that need more faults than exploration reaches.
 */
import type { Bound, ScriptStep } from './explore';
import type { FaultKind, Scenario } from './world';

export const EVERY_FAULT: FaultKind[] = [
  'hide',
  'show',
  'close',
  'kill',
  'crash-engine',
  'restart-coordinator',
  'crash-process',
  'lose-coordinator',
  'hang-coordinator',
  'freeze',
  'thaw',
  'bfcache',
  'restore',
  'expire-session',
  'offline',
  'online',
  'hold-owner-lock',
  'hold-files',
  'open-newer',
  'fail-open',
  'corrupt-database',
  'require-reset',
  'fail-assets',
  'stall-assets',
];

const HORIZON_MS = 60_000;

/** Faults that end or move the owner, where message order matters most. */
const LEAVING: FaultKind[] = ['hide', 'close'];

export type CheckedScenario = {
  scenario: Scenario;
  bound: Bound;
  /** Only in the deep run (`HANDOVER_CHECKER_DEEP=1`). */
  deep?: boolean;
};

export const SCENARIOS: CheckedScenario[] = [
  {
    scenario: {
      name: 'one tab, one fault',
      pages: [1],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 0, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'two tabs, one fault',
      pages: [1, 1],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 0, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'two tabs, one closing, one reordered message',
      pages: [1, 1],
      faults: ['close'],
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 1, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'two tabs, one late message',
      pages: [1, 1],
      faults: [],
      horizonMs: HORIZON_MS,
      late: true,
    },
    bound: { maxFaults: 0, maxDelays: 1, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'three tabs, one fault',
      pages: [1, 1, 1],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 0, maxRuns: 50_000 },
    deep: true,
  },
  {
    scenario: {
      name: 'an older and a newer tab, one fault',
      pages: [1, 2],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 0, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'two tabs, a tab leaving, one late message',
      pages: [1, 1],
      faults: LEAVING,
      horizonMs: HORIZON_MS,
      late: true,
    },
    bound: { maxFaults: 1, maxDelays: 1, maxRuns: 1_000_000 },
    deep: true,
  },
  {
    scenario: {
      name: 'two tabs, one fault, one reordered message',
      pages: [1, 1],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 1, maxDelays: 1, maxRuns: 1_000_000 },
    deep: true,
  },
  {
    scenario: {
      name: "two tabs, the owner's engine dies and its page hides",
      pages: [1, 1],
      faults: ['crash-engine', 'hide'],
      horizonMs: 15_000,
    },
    bound: { maxFaults: 2, maxDelays: 0, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'one tab, its database cannot be read and its engine dies',
      pages: [1],
      faults: ['corrupt-database', 'crash-engine'],
      horizonMs: 15_000,
    },
    bound: { maxFaults: 2, maxDelays: 0, maxRuns: 50_000 },
  },
  {
    scenario: {
      name: 'two tabs, two faults',
      pages: [1, 1],
      faults: EVERY_FAULT,
      horizonMs: HORIZON_MS,
    },
    bound: { maxFaults: 2, maxDelays: 0, maxRuns: 1_000_000 },
    deep: true,
  },
];

export type ScriptedScenario = {
  name: string;
  pages: number[];
  script: ScriptStep[];
  /** Its sends are not written: the server's answer comes too late. */
  unwritten?: true;
};

const repeat = (times: number, steps: ScriptStep[]): ScriptStep[] =>
  Array.from({ length: times }, () => steps).flat();

export const SCRIPTS: ScriptedScenario[] = [
  // The server answers a head `SERVER_MS` after it was sent, long after the
  // newer build asked for the database.
  {
    name: 'an older tab is sending a write when a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2' },
      { kind: 'open-newer' },
      { waitMs: 120_000 },
    ],
  },
  {
    name: 'the owner is sending a write when a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab1' },
      { kind: 'open-newer' },
      { waitMs: 120_000 },
    ],
  },
  // A refused write and one put back for a retry settle in the old engine too.
  {
    name: 'a write the server refused is rolled back as a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', settle: 'rollback' },
      { kind: 'open-newer' },
      { waitMs: 120_000 },
    ],
  },
  {
    name: 'a write put back for a retry as a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab1', settle: 'defer' },
      { kind: 'open-newer' },
      { waitMs: 120_000 },
    ],
  },
  // Just inside `SETTLEMENT_WAIT_MS`, and the newer build still gets its cache.
  {
    name: 'a write sent as a newer build opens is answered a minute later',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', serverMs: 65_000 },
      { kind: 'open-newer' },
      { waitMs: 180_000 },
    ],
  },
  // The owner would drain on hiding and park, and a newer build would then
  // open the free database without asking, under a head still out.
  {
    name: 'every tab hides while a write is out, then a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', serverMs: 10_000 },
      { kind: 'hide', page: 'tab1' },
      { kind: 'hide', page: 'tab2' },
      { waitMs: 4_000 },
      { kind: 'open-newer' },
      { waitMs: 400_000 },
    ],
  },
  // The same, reached by the owner closing rather than hiding.
  {
    name: 'the owner closes while a hidden tab has a write out, then a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', serverMs: 10_000 },
      { waitMs: 1_000 },
      { kind: 'hide', page: 'tab2' },
      { kind: 'close', page: 'tab1' },
      { waitMs: 2_000 },
      { kind: 'open-newer' },
      { waitMs: 400_000 },
    ],
  },
  {
    name: 'every tab hides while a write is out, the owner closes, then a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', serverMs: 10_000 },
      { kind: 'hide', page: 'tab1' },
      { kind: 'hide', page: 'tab2' },
      { waitMs: 4_000 },
      { kind: 'close', page: 'tab1' },
      { waitMs: 2_000 },
      { kind: 'open-newer' },
      { waitMs: 400_000 },
    ],
  },
  // The engine starts in the tab sending the answer, not in a frozen one.
  {
    name: 'the owner closes while a hidden tab sends a write and another hidden tab is frozen',
    pages: [1, 1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab3', serverMs: 10_000 },
      { waitMs: 1_000 },
      { kind: 'hide', page: 'tab2' },
      { kind: 'freeze', page: 'tab2' },
      { kind: 'hide', page: 'tab3' },
      { kind: 'close', page: 'tab1' },
      { waitMs: 2_000 },
      { kind: 'open-newer' },
      { waitMs: 400_000 },
    ],
  },
  // Until the coordinator sees the engine is gone, the lock is free.
  {
    name: "the owner's engine crashes while another tab sends a write, and a newer build opens",
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2', serverMs: 10_000 },
      { waitMs: 1_000 },
      { kind: 'crash-engine', page: 'tab1' },
      { kind: 'open-newer' },
      { waitMs: 400_000 },
    ],
    unwritten: true,
  },
  // Past it: the newer build goes ahead, and the answer finds nothing to settle.
  {
    name: 'a tab is frozen while it sends a write and a newer build opens',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { send: 'tab2' },
      { kind: 'hide', page: 'tab2' },
      { kind: 'freeze', page: 'tab2' },
      { kind: 'open-newer' },
      { waitMs: 120_000 },
      { kind: 'thaw', page: 'tab2' },
      { waitMs: 20_000 },
    ],
    unwritten: true,
  },
  {
    name: "a database that cannot be read, when its owner's engine dies",
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'corrupt-database' },
      { kind: 'crash-engine', page: 'tab1' },
      { waitMs: 60_000 },
    ],
  },
  {
    name: 'a database that cannot be read, when its owner closes',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'corrupt-database' },
      { kind: 'close', page: 'tab1' },
      { waitMs: 60_000 },
    ],
  },
  {
    name: 'an owner signed out as it writes, its database unreadable',
    pages: [1, 1],
    script: [
      { waitMs: 0 },
      { kind: 'corrupt-database' },
      { kind: 'expire-session', page: 'tab1' },
      { waitMs: 60_000 },
    ],
  },
  {
    name: 'the owner is hidden, then frozen before its drain ends',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'hide', page: 'tab1' },
      { kind: 'freeze', page: 'tab1' },
      { waitMs: 120_000 },
    ],
  },
  {
    name: 'a hidden owner, frozen before its drain ends, thaws again',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'hide', page: 'tab1' },
      { kind: 'freeze', page: 'tab1' },
      { waitMs: 120_000 },
      { kind: 'thaw', page: 'tab1' },
      { waitMs: 500 },
    ],
  },
  {
    name: 'a hidden owner, frozen before its drain ends, is discarded',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'hide', page: 'tab1' },
      { kind: 'freeze', page: 'tab1' },
      { waitMs: 120_000 },
      { kind: 'kill', page: 'tab1' },
      { waitMs: 500 },
    ],
  },
  {
    name: 'the owner is hidden and shown again and again',
    pages: [1],
    script: [
      { waitMs: 5_000 },
      ...repeat(5, [
        { kind: 'hide', page: 'tab1' },
        { waitMs: 500 },
        { kind: 'show', page: 'tab1' },
        { waitMs: 500 },
      ]),
    ],
  },
  {
    name: 'a busy owner lock blocks a handoff, then its candidate hides',
    pages: [1],
    script: [
      { waitMs: 5_000 },
      { kind: 'hide', page: 'tab1' },
      { waitMs: 2_000 },
      { kind: 'hold-owner-lock' },
      { kind: 'show', page: 'tab1' },
      { waitMs: 2_000 },
      { kind: 'hide', page: 'tab1' },
      { waitMs: 30_000 },
      { kind: 'show', page: 'tab1' },
      { waitMs: 500 },
    ],
  },
  {
    name: "the owner's engine crashes again and again",
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      ...repeat(6, [
        { kind: 'crash-engine', page: 'tab1' },
        { waitMs: 20_000 },
        { kind: 'crash-engine', page: 'tab2' },
        { waitMs: 20_000 },
      ]),
    ],
  },
  {
    name: 'the coordinator restarts again and again',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      ...repeat(12, [{ kind: 'restart-coordinator' }, { waitMs: 20_000 }]),
    ],
  },
  {
    name: 'the coordinator restarts twice while a tab starts',
    pages: [1],
    script: [
      { kind: 'restart-coordinator' },
      { kind: 'restart-coordinator' },
      { waitMs: 20_000 },
    ],
  },
  {
    name: 'a starting tab goes into the back/forward cache and comes back',
    pages: [1],
    script: [
      { kind: 'bfcache', page: 'tab1' },
      { waitMs: 20_000 },
      { kind: 'restore', page: 'tab1' },
      { waitMs: 20_000 },
    ],
  },
  {
    name: 'the owner goes into the back/forward cache and comes back',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      { kind: 'bfcache', page: 'tab1' },
      { waitMs: 20_000 },
      { kind: 'restore', page: 'tab1' },
      { waitMs: 20_000 },
    ],
  },
  {
    name: 'a recovery open fails again and again',
    pages: [1, 1],
    script: [
      { waitMs: 5_000 },
      ...repeat(3, [{ kind: 'fail-open' }]),
      { kind: 'crash-engine', page: 'tab1' },
      { waitMs: 120_000 },
    ],
  },
  {
    name: 'the database fails to open six times in a row',
    pages: [1, 1],
    script: [...repeat(6, [{ kind: 'fail-open' }]), { waitMs: 120_000 }],
  },
];
