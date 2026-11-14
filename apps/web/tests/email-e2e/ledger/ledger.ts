// The coverage ledger: the manifest against the evidence of a run, and the
// manifest against what the source defines.

import { existsSync } from 'node:fs';
import {
  EMAIL_SOURCE,
  graphqlOperations,
  hotkeys,
  restCalls,
  sourceFiles,
  toasts,
} from './derive';
import type { RunResult, Test } from './evidence';
import { type FileLines, lineCoverage, loadRan } from './lines';
import { GROUPS } from './manifest';
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
import { REPOSITORY, runPaths, WEB } from './paths';

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
  rows: Row[];
  operations: OperationRow[];
  /** Requests the app made that the manifest does not list. */
  unlisted: { request: string; answeredBy: string; count: number }[];
  drift: Drift[];
  lines: {
    measured: boolean;
    /** By source file, from the repository. */
    files: Map<string, FileLines>;
    /** Email source files the bundle holds no line of. */
    notBundled: string[];
    /** The files that are email's own, as opposed to cited by a row. */
    email: (file: string) => boolean;
  };
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

export function buildLedger(
  gating: RunResult,
  knownBugs: RunResult,
  dist: string | undefined
): Ledger {
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

  // Lines.
  const emailFiles = EMAIL_SOURCE.flatMap(sourceFiles).map(
    (file) => `apps/web/${file}`
  );
  const email = (file: string) =>
    EMAIL_SOURCE.some((dir) => file.startsWith(`apps/web/${dir}/`));
  const cited = new Set(
    (GROUPS as readonly Group[])
      .flatMap((group) => [...group.actions, ...group.states])
      .flatMap((row) => row.source)
      .map((file) => (file.startsWith('src/') ? `apps/web/${file}` : file))
  );
  const ran = loadRan(runPaths('gating').scripts);
  const measured = dist !== undefined && existsSync(dist) && ran.size > 0;
  const files = measured
    ? lineCoverage(
        dist,
        REPOSITORY,
        ran,
        (file) => email(file) || cited.has(file)
      )
    : new Map<string, FileLines>();
  // Generated code and tests are not what the suite is measured on.
  for (const file of files.keys()) {
    if (email(file) && !emailFiles.includes(file)) files.delete(file);
  }

  const counted = gating.tests.filter((test) => !test.knownBug);
  return {
    rows,
    operations,
    unlisted: [...unlisted.entries()]
      .map(([request, entry]) => ({ request, ...entry }))
      .sort((a, b) => a.request.localeCompare(b.request)),
    drift,
    lines: {
      measured,
      files,
      notBundled: measured ? emailFiles.filter((file) => !files.has(file)) : [],
      email,
    },
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
