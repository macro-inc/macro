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
};

const repeat = (times: number, steps: ScriptStep[]): ScriptStep[] =>
  Array.from({ length: times }, () => steps).flat();

export const SCRIPTS: ScriptedScenario[] = [
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
