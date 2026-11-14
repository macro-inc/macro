// The coverage ledger: the manifest against the evidence of a run, and the
// manifest against what the source defines.

import { existsSync } from 'node:fs';
import { graphqlOperations, hotkeys, restCalls, toasts } from './derive';
import type { RunResult, Test } from './evidence';
import { GROUPS } from './manifest';
import { type EmailFunction, FUNCTIONS } from './manifest/functions';
import { GRAPHQL, OPERATIONS, REST } from './manifest/network';
import {
  type Action,
  BOTH_PROVIDERS,
  type Group,
  type Operation,
  type Provider,
  type State,
  type Surface,
  type Viewport,
} from './manifest/types';
import { REPOSITORY, WEB } from './paths';

export type Status =
  | 'covered' // on every provider and every layout it applies to
  | 'partial' // on some
  | 'open' // on none, and this suite can drive it
  | 'deferred' // on none, and it needs what the per-test stack lacks
  | 'waived';

export type Row = {
  id: string;
  kind: 'action' | 'state';
  group: string;
  surface: string;
  surfaceName: string;
  text: string;
  trigger: string;
  providers: readonly Provider[];
  viewports: readonly Viewport[];
  status: Status;
  /** The functions it belongs to. */
  fn: readonly string[];
  /** Why it is deferred or waived. */
  reason?: string;
  /** The `provider/viewport` pairs a counted test ran it on. */
  cells: string[];
  /** What is still missing, as `gmail`, `phone`. */
  missing: string[];
  tests: string[];
  /** Only a test kept for a known bug touches it. */
  knownBugOnly: boolean;
};

/** What the counted tests on one provider showed of a function. */
export type FunctionOn = {
  /** One test did it through the UI and checked the result everywhere it is checked. */
  covered: boolean;
  /** Over all tests, not necessarily in one. */
  performed: boolean;
  seen: boolean;
  confirmed: boolean;
  tests: string[];
};

export type FunctionRow = EmailFunction & {
  /** `backend`: no UI, so not the browser suite's to cover. */
  status: Status | 'backend';
  reason?: string;
  /** The action rows that do it. */
  variants: string[];
  /** The state rows that show its result. */
  states: string[];
  on: Record<Provider, FunctionOn>;
  /** What is still missing, per provider. */
  missing: string[];
};

export type FunctionTotals = {
  /** Functions with a UI. */
  total: number;
  /** On every provider it applies to. */
  covered: number;
  gmail: number;
  outlook: number;
  partial: number;
  open: number;
  deferred: number;
  waived: number;
  /** Without a UI: the backend's coverage counts them. */
  backend: number;
};

export function functionTotals(rows: readonly FunctionRow[]): FunctionTotals {
  const count = (status: FunctionRow['status']) =>
    rows.filter((row) => row.status === status).length;
  return {
    total: rows.length - count('backend'),
    covered: count('covered'),
    gmail: rows.filter((row) => row.on.gmail.covered).length,
    outlook: rows.filter((row) => row.on.outlook.covered).length,
    partial: count('partial'),
    open: count('open'),
    deferred: count('deferred'),
    waived: count('waived'),
    backend: count('backend'),
  };
}

/** Each function against what the counted tests showed of it. */
export function functionRows(
  functions: readonly EmailFunction[],
  evidence: readonly Pick<
    RunResult['evidence'][number],
    'provider' | 'file' | 'title' | 'functions'
  >[],
  rows: readonly Pick<Row, 'id' | 'kind' | 'fn' | 'status' | 'reason'>[]
): FunctionRow[] {
  return functions.map((fn): FunctionRow => {
    const mine = rows.filter((row) => row.fn.includes(fn.id));
    const actions = mine.filter((row) => row.kind === 'action');
    // Mail arriving, a count on a badge: the user does nothing, so there is
    // nothing to perform and the function is covered by what a test sees.
    const observed = actions.length === 0;
    const on = (provider: Provider): FunctionOn => {
      const found = evidence.flatMap((test) =>
        test.provider === provider
          ? test.functions
              .filter((each) => each.id === fn.id)
              .map((each) => ({
                ...each,
                test: `${test.file} › ${test.title}`,
              }))
          : []
      );
      const whole = (each: (typeof found)[number]) =>
        (observed || each.performed) &&
        each.seen &&
        (fn.checkedAt === 'ui' || each.confirmed);
      return {
        covered: found.some(whole),
        performed: found.some((each) => each.performed),
        seen: found.some((each) => each.seen),
        confirmed: found.some((each) => each.confirmed),
        tests: [...new Set(found.map((each) => each.test))].sort(),
      };
    };
    const state = { gmail: on('gmail'), outlook: on('outlook') };
    const touched = fn.providers.some(
      (provider) => state[provider].tests.length > 0
    );
    const missing = fn.providers.flatMap((provider) => {
      const of = state[provider];
      if (of.covered) return [];
      if (of.tests.length === 0) return touched ? [`${provider}: no test`] : [];
      const lacks = [
        observed || of.performed ? '' : 'not done through the UI',
        of.seen ? '' : 'result not checked in the UI',
        fn.checkedAt === 'ui' || of.confirmed
          ? ''
          : `result not checked at the ${fn.checkedAt}`,
      ].filter(Boolean);
      return [
        `${provider}: ${lacks.join(', ') || 'no one test does all of it'}`,
      ];
    });
    const ways = observed ? mine : actions;
    const every = (status: Status[]) =>
      ways.length > 0 && ways.every((row) => status.includes(row.status));
    const status: FunctionRow['status'] = !fn.ui
      ? 'backend'
      : fn.providers.every((provider) => state[provider].covered)
        ? 'covered'
        : touched
          ? 'partial'
          : every(['waived'])
            ? 'waived'
            : every(['waived', 'deferred'])
              ? 'deferred'
              : 'open';
    return {
      ...fn,
      status,
      reason:
        status === 'waived' || status === 'deferred'
          ? [...new Set(ways.map((row) => row.reason))].join('; ')
          : undefined,
      variants: actions.map((row) => row.id),
      states: mine.filter((row) => row.kind === 'state').map((row) => row.id),
      on: state,
      missing,
    };
  });
}

export type OperationRow = Operation & {
  status: Status | 'stubbed' | 'failed';
  providers: Provider[];
  viewports: Viewport[];
  /** How often a service answered it. */
  count: number;
};

export type Totals = {
  total: number;
  waived: number;
  deferred: number;
  /** A counted test ran it at all. */
  covered: number;
  /** On every provider and layout it applies to. */
  complete: number;
  bothProviders: number;
  gmail: number;
  outlook: number;
  desktop: number;
  phone: number;
};

export function totals(rows: readonly Row[]): Totals {
  const on = (cell: string) =>
    rows.filter((row) =>
      row.cells.some((each) => each.split('/').includes(cell))
    ).length;
  return {
    total: rows.length,
    waived: rows.filter((row) => row.status === 'waived').length,
    deferred: rows.filter((row) => row.status === 'deferred').length,
    covered: rows.filter((row) => row.cells.length > 0).length,
    complete: rows.filter((row) => row.status === 'covered').length,
    bothProviders: rows.filter((row) =>
      BOTH_PROVIDERS.every((provider) =>
        row.cells.some((cell) => cell.startsWith(`${provider}/`))
      )
    ).length,
    gmail: on('gmail'),
    outlook: on('outlook'),
    desktop: on('desktop'),
    phone: on('phone'),
  };
}

export type Drift = {
  /** What it is about, as a heading. */
  check: string;
  items: string[];
};

export type Ledger = {
  functions: FunctionRow[];
  rows: Row[];
  operations: OperationRow[];
  /** Requests the app made that the manifest does not list. */
  unlisted: { request: string; answeredBy: string; count: number }[];
  drift: Drift[];
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: Test[];
    knownBugs: number;
    seconds: number;
  };
};

function rowsOf(
  group: Group,
  cells: Map<string, Set<string>>,
  tests: Map<string, Set<string>>,
  knownBugRows: Set<string>
): Row[] {
  const surfaces = new Map<string, Surface>(
    group.surfaces.map((surface) => [surface.id, surface])
  );
  const one = (kind: Row['kind'], row: Action | State, text: string): Row => {
    const surface = surfaces.get(row.surface);
    const providers = row.providers ?? BOTH_PROVIDERS;
    const viewports = row.viewports ?? surface?.viewports ?? [];
    const seen = [...(cells.get(row.id) ?? [])].sort();
    const missing = [
      ...providers.filter(
        (provider) => !seen.some((cell) => cell.startsWith(`${provider}/`))
      ),
      ...viewports.filter(
        (viewport) => !seen.some((cell) => cell.endsWith(`/${viewport}`))
      ),
    ];
    const waiver = row.waiver ?? surface?.waiver;
    const needs = row.needs ?? surface?.needs;
    const status: Status =
      seen.length > 0
        ? missing.length === 0
          ? 'covered'
          : 'partial'
        : waiver
          ? 'waived'
          : needs
            ? 'deferred'
            : 'open';
    return {
      id: row.id,
      kind,
      group: group.name,
      surface: row.surface,
      surfaceName: surface?.name ?? '?',
      text,
      trigger: row.trigger,
      fn: row.fn ?? [],
      providers,
      viewports,
      status,
      reason:
        status === 'waived'
          ? `${waiver?.kind}: ${waiver?.reason}`
          : status === 'deferred'
            ? needs
            : undefined,
      cells: seen,
      missing: seen.length > 0 ? missing : [],
      tests: [...(tests.get(row.id) ?? [])].sort(),
      knownBugOnly: seen.length === 0 && knownBugRows.has(row.id),
    };
  };
  return [
    ...group.actions.map((row: Action) => one('action', row, row.action)),
    ...group.states.map((row: State) => one('state', row, row.state)),
  ];
}

/** Finds the REST operation a request is, the most literal match first. */
export function restMatcher(
  operations: readonly Operation[]
): (method: string, path: string) => string | undefined {
  const patterns = operations
    .filter((operation) => operation.kind === 'rest')
    .map((operation) => {
      const [method, path] = operation.id.split(' ');
      const pattern = path
        .split('{}')
        .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
        .join('[^/]+');
      return {
        id: operation.id,
        method,
        pattern: new RegExp(`^${pattern}$`),
        holes: path.split('{}').length - 1,
      };
    })
    .sort((a, b) => a.holes - b.holes);
  return (method, path) =>
    patterns.find((each) => each.method === method && each.pattern.test(path))
      ?.id;
}

/** A path with what looks like an id replaced, to group unlisted requests. */
function shape(path: string): string {
  return path
    .split('/')
    .map((part) =>
      /^[0-9a-f-]{16,}$/i.test(part) ||
      /^\d+$/.test(part) ||
      part.includes('%40')
        ? '{}'
        : part
    )
    .join('/');
}

function difference(
  check: string,
  defined: string[],
  listed: string[],
  what: { missing: string; stale: string }
): Drift[] {
  const drift: Drift[] = [];
  const missing = defined.filter((each) => !listed.includes(each));
  const stale = listed.filter((each) => !defined.includes(each));
  if (missing.length) {
    drift.push({ check: `${check}: ${what.missing}`, items: missing });
  }
  if (stale.length)
    drift.push({ check: `${check}: ${what.stale}`, items: stale });
  return drift;
}

function manifestDrift(): Drift[] {
  const drift: Drift[] = [];
  const ids = GROUPS.flatMap((group: Group) => [
    ...group.surfaces.map((row) => row.id),
    ...group.actions.map((row) => row.id),
    ...group.states.map((row) => row.id),
  ]);
  const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (twice.length) drift.push({ check: 'Ids used twice', items: twice });

  const lost: string[] = [];
  const gone: string[] = [];
  for (const group of GROUPS as readonly Group[]) {
    const surfaces = new Set(group.surfaces.map((surface) => surface.id));
    for (const row of [...group.actions, ...group.states]) {
      if (!surfaces.has(row.surface)) {
        lost.push(
          `${row.id}: ${row.surface} is not a surface of ${group.name}`
        );
      }
      if (row.source.length === 0) gone.push(`${row.id}: names no source file`);
      for (const file of row.source) {
        const path = file.startsWith('src/')
          ? `${WEB}${file}`
          : `${REPOSITORY}${file}`;
        if (!existsSync(path)) gone.push(`${row.id}: ${file}`);
      }
    }
  }
  if (lost.length)
    drift.push({ check: 'Rows on an unknown surface', items: lost });
  if (gone.length) {
    drift.push({ check: 'Rows whose source file is gone', items: gone });
  }

  const actions = (GROUPS as readonly Group[]).flatMap(
    (group) => group.actions
  );
  const states = (GROUPS as readonly Group[]).flatMap((group) => group.states);

  const known = new Map(FUNCTIONS.map((fn) => [fn.id, fn]));
  const all = [...actions, ...states];
  const unknown = all.flatMap((row) =>
    (row.fn ?? [])
      .filter((fn) => !known.has(fn))
      .map((fn) => `${row.id}: ${fn}`)
  );
  if (unknown.length) {
    drift.push({
      check: 'Rows of a function that is not in functions.tsv',
      items: unknown,
    });
  }
  const loose = all.filter((row) => !row.fn?.length).map((row) => row.id);
  if (loose.length) {
    drift.push({ check: 'Rows that belong to no function', items: loose });
  }
  const done = new Set(all.flatMap((row) => row.fn ?? []));
  const undoable = FUNCTIONS.filter((fn) => fn.ui && !done.has(fn.id));
  if (undoable.length) {
    drift.push({
      check: 'Functions with a UI and no row',
      items: undoable.map((fn) => `${fn.id} ${fn.name}`),
    });
  }
  const twiceFn = FUNCTIONS.map((fn) => fn.id).filter(
    (id, index, ids) => ids.indexOf(id) !== index
  );
  if (twiceFn.length)
    drift.push({ check: 'Function ids used twice', items: twiceFn });
  drift.push(
    ...difference(
      'Hotkeys and commands',
      hotkeys().map((each) => each.key),
      [...new Set(actions.flatMap((row) => row.registered ?? []))],
      {
        missing: 'registered in the source, on no action row',
        stale: 'on an action row, no longer registered',
      }
    ),
    ...difference(
      'Toasts',
      toasts().map((each) => each.key),
      [...new Set(states.flatMap((row) => row.toasts ?? []))],
      {
        missing: 'raised in the source, on no state row',
        stale: 'on a state row, no longer raised',
      }
    ),
    ...difference(
      'GraphQL operations',
      graphqlOperations().map((each) => each.id),
      GRAPHQL.map((each) => each.id),
      {
        missing: 'in a document, not in the network list',
        stale: 'in the network list, in no document',
      }
    ),
    ...difference(
      'Email service calls',
      restCalls().map((each) => each.id),
      REST.map((each) => each.id),
      {
        missing: 'in the client, not in the network list',
        stale: 'in the network list, not in the client',
      }
    )
  );
  return drift;
}

export function buildLedger(gating: RunResult, knownBugs: RunResult): Ledger {
  // Rows.
  const cells = new Map<string, Set<string>>();
  const tests = new Map<string, Set<string>>();
  for (const evidence of gating.evidence) {
    for (const id of evidence.rows) {
      if (!cells.has(id)) cells.set(id, new Set());
      if (!tests.has(id)) tests.set(id, new Set());
      cells.get(id)?.add(`${evidence.provider}/${evidence.viewport}`);
      tests.get(id)?.add(`${evidence.file} › ${evidence.title}`);
    }
  }
  const knownBugRows = new Set(knownBugs.evidence.flatMap((each) => each.rows));
  const rows = (GROUPS as readonly Group[]).flatMap((group) =>
    rowsOf(group, cells, tests, knownBugRows)
  );

  const drift = manifestDrift();
  const known = new Set(rows.map((row) => row.id));
  const strangers = [...cells.keys()].filter((id) => !known.has(id));
  if (strangers.length) {
    drift.push({
      check: 'Rows a test recorded that the manifest lacks',
      items: strangers,
    });
  }

  // Network operations.
  const match = restMatcher(OPERATIONS);
  type Seen = {
    real: number;
    stubbed: number;
    failed: number;
    providers: Set<Provider>;
    viewports: Set<Viewport>;
  };
  const seen = new Map<string, Seen>();
  const unlisted = new Map<string, { answeredBy: string; count: number }>();
  const listed = new Set(OPERATIONS.map((operation) => operation.id));
  for (const evidence of gating.evidence) {
    for (const request of evidence.requests) {
      if (request.fromTest) continue;
      const real =
        request.answeredBy === 'email' || request.answeredBy === 'dss';
      const path = real
        ? `/${request.answeredBy}${request.path}`
        : request.path;
      const ids =
        request.operations.length > 0
          ? request.operations
          : [
              match(request.method, path) ??
                `? ${request.method} ${shape(path)}`,
            ];
      for (const id of ids) {
        if (!listed.has(id)) {
          const key = id.startsWith('? ') ? id.slice(2) : `GraphQL ${id}`;
          const entry = unlisted.get(key) ?? {
            answeredBy: request.answeredBy,
            count: 0,
          };
          entry.count += request.count;
          unlisted.set(key, entry);
          continue;
        }
        const entry = seen.get(id) ?? {
          real: 0,
          stubbed: 0,
          failed: 0,
          providers: new Set(),
          viewports: new Set(),
        };
        seen.set(id, entry);
        if (!real) entry.stubbed += request.count;
        else if (request.status >= 400) entry.failed += request.count;
        else {
          entry.real += request.count;
          entry.providers.add(evidence.provider);
          entry.viewports.add(evidence.viewport);
        }
      }
    }
  }
  const operations = OPERATIONS.map((operation): OperationRow => {
    const entry = seen.get(operation.id);
    const status: OperationRow['status'] = entry?.real
      ? BOTH_PROVIDERS.every((provider) => entry.providers.has(provider))
        ? 'covered'
        : 'partial'
      : entry?.failed
        ? 'failed'
        : entry?.stubbed
          ? 'stubbed'
          : operation.waiver
            ? 'waived'
            : operation.needs
              ? 'deferred'
              : 'open';
    return {
      ...operation,
      status,
      providers: [...(entry?.providers ?? [])].sort(),
      viewports: [...(entry?.viewports ?? [])].sort(),
      count: entry?.real ?? 0,
    };
  });

  const counted = gating.tests.filter((test) => !test.knownBug);
  return {
    functions: functionRows(FUNCTIONS, gating.evidence, rows),
    rows,
    operations,
    unlisted: [...unlisted.entries()]
      .map(([request, entry]) => ({ request, ...entry }))
      .sort((a, b) => a.request.localeCompare(b.request)),
    drift,
    tests: {
      total: counted.length,
      passed: counted.filter((test) => test.status === 'expected').length,
      failed: counted.filter((test) => test.status === 'unexpected').length,
      skipped: counted.filter((test) => test.status === 'skipped').length,
      flaky: counted.filter((test) => test.status === 'flaky'),
      knownBugs: knownBugs.tests.length,
      seconds: Math.round(
        counted
          .flatMap((test) => test.results)
          .reduce((sum, result) => sum + result.duration, 0) / 1000
      ),
    },
  };
}
