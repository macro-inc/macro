#!/usr/bin/env bun
/**
 * Real-model regression checks against the synthetic database examples.
 *
 * bun scripts/evaluate-database-ai.ts                 # describe, no requests
 * bun scripts/evaluate-database-ai.ts --seed          # add missing fixtures only
 * bun scripts/evaluate-database-ai.ts --run           # local model/API checks
 * bun scripts/evaluate-database-ai.ts --seed --run    # fixtures then evaluations
 * bun scripts/evaluate-database-ai.ts --run --case delegated-agent-discovers-tickets
 * bun scripts/evaluate-database-ai.ts --run --output /tmp/database-ai.json
 *
 * Requires an authenticated, already-open local Chromium tab (CDP 9334), the
 * local backend, and database-examples.ts fixtures. Never navigates. Seeding is
 * opt-in; evaluations change only "AI evaluation" and its two personal views.
 * Uses Chromium's cookie jar; reports contain no credentials or storage dumps.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { selectSavedDatabaseViews } from '../src/features/block-database/queries/saved-database-view-data';
import {
  parseQueryProposal,
  type QuerySchema,
  quoteIdentifier,
} from '../src/features/database-query/core/query';
import {
  isChartMode,
  prepareQueryChart,
} from '../src/features/database-query/core/query-chart';
import { databaseCompletionRequest } from '../src/lib/service-clients/service-cognition/database-query-prompt';
import type { StructuredCompletionRequest } from '../src/lib/service-clients/service-cognition/generated/schemas/structuredCompletionRequest';
import type { StructuredCompletionResponse } from '../src/lib/service-clients/service-cognition/generated/schemas/structuredCompletionResponse';
import type {
  DatabaseDetail,
  DatabaseTableDetail,
  ExecOutcome,
  ListedDatabase,
} from '../src/lib/service-clients/service-storage/databases';
import type { ViewsResponse } from '../src/lib/service-clients/service-storage/generated/schemas/viewsResponse';
import {
  databaseExamples,
  seedDatabaseExamples,
} from '../tests/e2e/fixtures/database-examples';

type Mode = 'question' | 'assistant' | 'general';
type ReportEntry = {
  label: string;
  prompt: string;
  mode: Mode;
  elapsedMs: number;
  passed: boolean;
  verifiedOutcome?: boolean;
  recoveredToolErrors?: number;
  error?: string;
  completion?: StructuredCompletionResponse;
  answer?: ExecOutcome;
};
type Request = <T>(path: string, body?: unknown) => Promise<T>;

/** Playwright request errors include headers/cookies after the first line. */
export function evaluationError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}

/** Fail closed before connecting to a browser or issuing authenticated writes. */
export function localOrigin(value: string): string {
  const url = new URL(value);
  assert(
    ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]' ||
        url.hostname.endsWith('.localhost')),
    'Evaluation endpoints must be local HTTP origins without credentials'
  );
  return url.origin;
}

const evaluationLabels = [
  'automatic-tickets-source',
  'automatic-sales-source',
  'explicit-database-all-tables',
  'tickets-discovery-from-sales',
  'readonly-write-refusal',
  'general-agent-discovers-tickets',
  'delegated-agent-discovers-tickets',
  'enterprise-join',
  'open-estimate',
  'bar-status',
  'pie-stage',
  'line-won-month',
  'build-table-and-board-idempotently',
  'modify-select-and-save-filtered-view',
];

export function configuration(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
) {
  for (let index = 0; index < args.length; index++) {
    if (['--output', '--case'].includes(args[index])) {
      const flag = args[index];
      assert(
        args[++index] && !args[index].startsWith('--'),
        `${flag} requires a value`
      );
    } else {
      assert(
        ['--run', '--seed', '--help'].includes(args[index]),
        `Unknown argument: ${args[index]}`
      );
    }
  }
  const outputIndex = args.indexOf('--output');
  const output = resolve(
    outputIndex < 0
      ? (env.DATABASE_AI_EVAL_OUTPUT ??
          '/tmp/macro-database-ai-evaluation.json')
      : args[outputIndex + 1]
  );
  assert(output.startsWith('/tmp/'), 'Evaluation reports must be under /tmp');
  const caseIndex = args.indexOf('--case');
  const selectedCase = caseIndex < 0 ? undefined : args[caseIndex + 1];
  assert(
    !selectedCase || evaluationLabels.includes(selectedCase),
    'Unknown evaluation case'
  );
  return {
    run: args.includes('--run') && !args.includes('--help'),
    seed: args.includes('--seed') && !args.includes('--help'),
    selectedCase,
    base: localOrigin(
      env.DATABASE_AI_EVAL_BASE_URL ?? 'http://database-ui.localhost:21710'
    ),
    backend: localOrigin(
      env.DATABASE_AI_EVAL_BACKEND_URL ?? 'http://database-ui.localhost:21709'
    ),
    cdp: localOrigin(env.DATABASE_AI_EVAL_CDP_URL ?? 'http://localhost:9334'),
    output,
  };
}

function authenticatedRequest(
  page: Page,
  base: string,
  backend: string
): Request {
  assert.equal(new URL(page.url()).origin, base);
  // Playwright shares Chromium's cookies internally. Use its API context so
  // user navigation/HMR cannot cancel a model call after a write has committed.
  const api = page.context().request;
  return async <T>(path: string, body?: unknown): Promise<T> => {
    assert(/^\/(dss|cognition)\//.test(path), 'Unexpected API path');
    const response = await api.fetch(`${backend}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      maxRedirects: 0,
      timeout: 180_000,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { data: body }),
    });
    if (!response.ok()) {
      const detail = response.status() === 422 ? await response.text() : '';
      throw new Error(
        `${path} returned HTTP ${response.status()}${detail ? `: ${detail.slice(0, 1000)}` : ''}`
      );
    }
    return (await response.json()) as T;
  };
}

function tableNamed(detail: DatabaseDetail, name: string) {
  const matches = detail.tables.filter((item) => item.table.name === name);
  assert.equal(matches.length, 1, `Expected exactly one ${name} table`);
  return matches[0];
}

function columnNamed(table: DatabaseTableDetail, name: string) {
  const matches = table.columns.filter(
    (column) =>
      (column.column.display_name ??
        column.definition.definition.display_name) === name
  );
  assert.equal(matches.length, 1, `Expected exactly one ${name} column`);
  return matches[0];
}

// Build the same small schema contract as the panel without importing its
// Solid Query/runtime service modules into this standalone script.
function querySchema(detail: DatabaseDetail, focus: string): QuerySchema {
  return {
    databaseId: detail.database.id,
    name: detail.database.name,
    focusTableId: tableNamed(detail, focus).table.id,
    tables: detail.tables.map((table) => ({
      id: table.table.id,
      name: table.table.name,
      sqlName: table.read_sql_name ?? table.sql_name,
      primaryKey: 'row_id',
      columns: table.columns.map((column) => ({
        name:
          column.column.display_name ??
          column.definition.definition.display_name,
        sqlName: column.sql_name,
        type: column.definition.definition.data_type,
        options: column.definition.property_options.map((option) =>
          String(option.value.value)
        ),
        multiple: column.definition.definition.is_multi_select,
      })),
    })),
  };
}

const databaseTools = new Set([
  'ListDatabases',
  'DescribeDatabase',
  'CreateDatabase',
  'CreateTable',
  'AddColumn',
  'AddColumnOptions',
  'QueryDatabase',
  'SaveDatabaseView',
]);
const mutationTools = new Set([
  'CreateDatabase',
  'CreateTable',
  'AddColumn',
  'AddColumnOptions',
  'SaveDatabaseView',
]);

function assertActivity(
  completion: StructuredCompletionResponse,
  mode: Mode,
  readonly: boolean
) {
  assert(Array.isArray(completion.toolActivity), 'Missing server activity');
  for (const activity of completion.toolActivity) {
    if (mode === 'question') {
      assert(
        ['ListDatabases', 'DescribeDatabase', 'QueryDatabase'].includes(activity.name),
        'A document question used a capability beyond discovery and read-only SQL'
      );
    }
    assert(
      databaseTools.has(activity.name) ||
        (mode === 'general' && activity.name === 'Subagent'),
      'An unrelated tool was invoked'
    );
    if (readonly || mode === 'question') {
      assert(
        !mutationTools.has(activity.name),
        'A question invoked a mutation'
      );
      assert.equal(activity.changesApplied ?? 0, 0, 'A question changed rows');
    }
  }
}

export function assertStableReads(sql: string, answer: ExecOutcome) {
  assert.equal(answer.changes_applied, 0, 'Verification SQL changed rows');
  assert.equal(answer.truncated_tables.length, 0, 'Answer read truncated data');
  assert(answer.read_tables.length > 0, 'Answer must read real seeded rows');
  for (const tableId of answer.read_tables) {
    assert(
      sql.toLowerCase().includes(`_macro_table_${tableId.replaceAll('-', '')}`),
      'Returned SQL must use stable table aliases so saved answers survive rename'
    );
  }
}

function assertScalar(answer: ExecOutcome, expected: number) {
  assert.equal(answer.results.length, 1);
  assert.equal(answer.results[0].columns.length, 1);
  assert.deepEqual(answer.results[0].rows, [[expected]]);
}

function assertRows(answer: ExecOutcome, expected: (string | number)[][]) {
  assert.equal(answer.results.length, 1);
  const sort = (rows: (string | number | null)[][]) =>
    rows.map((row) => JSON.stringify(row)).sort();
  assert.deepEqual(sort(answer.results[0].rows), sort(expected));
}

async function evaluate(config: ReturnType<typeof configuration>) {
  const browser = await chromium.connectOverCDP(config.cdp);
  const entries: ReportEntry[] = [];
  const startedAt = new Date().toISOString();
  const writeReport = async () => {
    await writeFile(
      config.output,
      JSON.stringify({ startedAt, entries }, null, 2)
    );
  };
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().startsWith(`${config.base}/`));
    assert(page, `Open an authenticated tab at ${config.base} first`);
    if (config.seed) {
      const seeded = await seedDatabaseExamples(page, config.backend);
      for (const { database } of seeded) {
        console.log(
          `${database.name}: ${config.base}/app/database/${database.id}`
        );
      }
      if (!config.run) return;
    }
    const request = authenticatedRequest(page, config.base, config.backend);
    const read = (sql: string) =>
      request<ExecOutcome>('/dss/databases/query', { sql });
    const list = await request<ListedDatabase[]>('/dss/databases');
    async function fixture(name: string) {
      const matches = list.filter((entry) => entry.database.name === name);
      assert.equal(matches.length, 1, `Seed exactly one ${name} first`);
      return request<DatabaseDetail>(
        `/dss/databases/${matches[0].database.id}`
      );
    }
    let support = await fixture(databaseExamples[0].name);
    const sales = await fixture(databaseExamples[1].name);
    const supportId = support.database.id;
    const refreshSupport = async () => {
      support = await request<DatabaseDetail>(`/dss/databases/${supportId}`);
    };
    const tickets = tableNamed(support, 'Tickets');
    const ticketCount = () =>
      read(`SELECT COUNT(*) FROM ${quoteIdentifier(tickets.read_sql_name!)}`);
    assertScalar(await ticketCount(), 12);

    async function run(input: {
      label: string;
      prompt: string;
      schema: QuerySchema;
      mode?: Mode;
      readonly?: boolean;
      refusal?: boolean;
      verify: (
        answer: ExecOutcome | undefined,
        completion: StructuredCompletionResponse
      ) => void | Promise<void>;
    }) {
      if (config.selectedCase && config.selectedCase !== input.label)
        return false;
      const start = performance.now();
      const entry: ReportEntry = {
        label: input.label,
        prompt: input.prompt,
        mode: input.mode ?? 'assistant',
        elapsedMs: 0,
        passed: false,
      };
      entries.push(entry);
      try {
        const scoped = databaseCompletionRequest(
          { prompt: input.prompt, sql: '', schema: input.schema },
          entry.mode === 'question' ? 'question' : 'assistant'
        );
        const completionRequest: StructuredCompletionRequest = {
          model: 'anthropic/claude-sonnet-5',
          ...(entry.mode === 'general'
            ? {
                prompt: input.prompt,
                toolset: { type: 'all' },
                output_schema: scoped.output_schema,
              }
            : scoped),
        };
        entry.completion = await request<StructuredCompletionResponse>(
          '/cognition/structured-completion',
          completionRequest
        );
        assertActivity(entry.completion, entry.mode, input.readonly ?? true);
        if (input.refusal) {
          assert(
            typeof entry.completion.result === 'object' &&
              entry.completion.result !== null
          );
          const result = entry.completion.result as Record<string, unknown>;
          assert.equal(result.answerable, false);
          assert.equal(result.sql, '');
          assert(typeof result.explanation === 'string' && result.explanation);
        } else {
          const proposal = parseQueryProposal(entry.completion.result);
          entry.answer = await read(proposal.sql);
          if (isChartMode(proposal.displayMode)) {
            const chart = prepareQueryChart(
              entry.answer,
              proposal.displayMode,
              proposal.chart
            );
            assert(!chart.error, chart.error);
          }
        }
        await input.verify(entry.answer, entry.completion);
        entry.verifiedOutcome = true;
        entry.recoveredToolErrors = entry.completion.toolActivity.filter(
          (activity) => !activity.success
        ).length;
        if (entry.answer) {
          const proposal = parseQueryProposal(entry.completion.result);
          assertStableReads(proposal.sql, entry.answer);
        }
        entry.passed = true;
      } catch (error) {
        entry.error = evaluationError(error);
      } finally {
        entry.elapsedMs = Math.round(performance.now() - start);
        await writeReport();
        console.log(
          `${entry.passed ? 'PASS' : 'FAIL'} ${entry.label} (${entry.elapsedMs} ms)${entry.error ? `: ${entry.error}` : ''}`
        );
      }
      return entry.passed;
    }

    for (const entry of [
      {
        label: 'automatic-tickets-source',
        prompt: 'How many tickets are there?',
        detail: support,
        expected: 12,
        dependencies: [tickets.table.id],
      },
      {
        label: 'automatic-sales-source',
        prompt: 'What is the total amount of won deals?',
        detail: sales,
        expected: 84000,
        dependencies: [tableNamed(sales, 'Deals').table.id],
      },
      {
        label: 'explicit-database-all-tables',
        prompt: 'How many tickets belong to Enterprise customers?',
        detail: support,
        expected: 8,
        dependencies: [tickets.table.id, tableNamed(support, 'Customers').table.id],
      },
    ]) {
      const automatic = entry.label.startsWith('automatic-');
      await run({
        label: entry.label,
        prompt: entry.prompt,
        mode: 'question',
        schema: automatic
          ? { name: 'Automatic', tables: [] }
          : { databaseId: entry.detail.database.id, name: entry.detail.database.name, tables: [] },
        verify: (answer, completion) => {
          assert(answer);
          assertScalar(answer, entry.expected);
          assert.deepEqual([...answer.read_tables].sort(), [...entry.dependencies].sort());
          assert.equal(parseQueryProposal(completion.result).databaseId, entry.detail.database.id);
          for (const name of automatic ? ['ListDatabases', 'QueryDatabase'] : ['DescribeDatabase', 'QueryDatabase']) {
            assert(completion.toolActivity.some((activity) => activity.name === name && activity.success));
          }
        },
      });
    }

    await run({
      label: 'tickets-discovery-from-sales',
      prompt:
        'How many tickets are there? I mean the Tickets table, even if it is in another database.',
      schema: querySchema(sales, 'Deals'),
      verify: (answer, completion) => {
        assert(answer);
        assertScalar(answer, 12);
        assert.deepEqual(answer.read_tables, [tickets.table.id]);
        assert(
          completion.toolActivity.some(
            (entry) => entry.name === 'ListDatabases'
          )
        );
      },
    });
    await run({
      label: 'readonly-write-refusal',
      prompt: 'Delete all Tickets records.',
      schema: querySchema(support, 'Tickets'),
      mode: 'question',
      refusal: true,
      verify: async () => assertScalar(await ticketCount(), 12),
    });
    await run({
      label: 'general-agent-discovers-tickets',
      prompt: 'How many rows are in the Tickets table?',
      // General mode deliberately sends no schema or database-panel instructions.
      schema: querySchema(sales, 'Deals'),
      mode: 'general',
      verify: (answer, completion) => {
        assert(answer);
        assertScalar(answer, 12);
        assert.deepEqual(answer.read_tables, [tickets.table.id]);
        assert(
          completion.toolActivity.some(
            (entry) => entry.name === 'ListDatabases'
          )
        );
      },
    });
    await run({
      label: 'delegated-agent-discovers-tickets',
      prompt:
        'Use a Subagent to discover the Tickets table and count its rows. Ask it to return the exact stable readSqlName and count, then verify its answer yourself. Do not change any data, schema, or views.',
      schema: querySchema(sales, 'Deals'),
      mode: 'general',
      verify: (answer, completion) => {
        assert(answer);
        assertScalar(answer, 12);
        assert.deepEqual(answer.read_tables, [tickets.table.id]);
        assert.equal(
          answer.read_versions[tickets.table.id],
          tickets.table.version,
          'Delegated lookup must not change Tickets'
        );
        assert(
          completion.toolActivity.some(
            (entry) => entry.name === 'Subagent' && entry.success
          )
        );
      },
    });
    for (const entry of [
      {
        label: 'enterprise-join',
        prompt:
          'How many tickets are from customers on the Enterprise plan? Join Tickets.Customer to Customers.Name.',
        expected: 8,
      },
      {
        label: 'open-estimate',
        prompt: 'What is the total estimate of Open tickets?',
        expected: 10,
      },
    ]) {
      await run({
        ...entry,
        schema: querySchema(support, 'Tickets'),
        verify: (answer) => {
          assert(answer);
          assertScalar(answer, entry.expected);
          const dependencies =
            entry.label === 'enterprise-join'
              ? [tickets.table.id, tableNamed(support, 'Customers').table.id]
              : [tickets.table.id];
          assert.deepEqual([...answer.read_tables].sort(), dependencies.sort());
        },
      });
    }
    for (const entry of [
      {
        label: 'bar-status',
        prompt: 'Show a bar chart of ticket counts by status.',
        detail: support,
        focus: 'Tickets',
        mode: 'bar',
        rows: [
          ['Done', 3],
          ['In progress', 3],
          ['Open', 4],
          ['Waiting', 2],
        ],
      },
      {
        label: 'pie-stage',
        prompt:
          'Show a pie chart of the total deal Amount by Stage, excluding Lost.',
        detail: sales,
        focus: 'Deals',
        mode: 'pie',
        rows: [
          ['Won', 84000],
          ['Qualified', 15000],
          ['Lead', 12000],
          ['Proposal', 9000],
        ],
      },
      {
        label: 'line-won-month',
        prompt:
          'Show a line chart of won deal amounts by closing month, in chronological order.',
        detail: sales,
        focus: 'Deals',
        mode: 'line',
        rows: [
          ['2026-07', 24000],
          ['2026-08', 24000],
          ['2026-09', 36000],
        ],
      },
    ]) {
      await run({
        label: entry.label,
        prompt: entry.prompt,
        schema: querySchema(entry.detail, entry.focus),
        verify: (answer, completion) => {
          assert(answer);
          const proposal = parseQueryProposal(completion.result);
          assert.equal(proposal.displayMode, entry.mode);
          assert(proposal.chart);
          const result = answer.results[0];
          const aliases = result.columns.map((column) => column.name);
          const x = aliases.indexOf(proposal.chart.x);
          const y = aliases.indexOf(proposal.chart.y[0]);
          assert.equal(proposal.chart.y.length, 1);
          const chartRows = result.rows.map((row) => [row[x], row[y]]);
          assertRows(
            { ...answer, results: [{ ...result, rows: chartRows }] },
            entry.rows
          );
          if (entry.mode === 'line') assert.deepEqual(chartRows, entry.rows);
        },
      });
    }

    const evaluationRows = async () => {
      const table = tableNamed(support, 'AI evaluation');
      const columns = ['Name', 'Status', 'Points'].map((name) =>
        quoteIdentifier(columnNamed(table, name).sql_name)
      );
      return read(
        `SELECT ${columns.join(', ')} FROM ${quoteIdentifier(table.read_sql_name!)} ORDER BY ${columns[0]}`
      );
    };
    const existingEvaluation = support.tables.filter(
      (table) => table.table.name === 'AI evaluation'
    );
    assert(existingEvaluation.length <= 1, 'Ambiguous AI evaluation tables');
    if (existingEvaluation.length) {
      const existing = await evaluationRows();
      const names = existing.results[0].rows.map((row) => row[0]);
      assert(
        names.every((name) =>
          ['Test import', 'Verify export'].includes(String(name))
        ),
        'AI evaluation contains non-fixture rows; refusing to change it'
      );
      assert.equal(
        new Set(names).size,
        names.length,
        'AI evaluation already contains duplicate fixture rows'
      );
    }
    async function savedView(name: string) {
      const response = await request<ViewsResponse>('/dss/saved_views');
      const table = tableNamed(support, 'AI evaluation');
      const matches = selectSavedDatabaseViews(
        response.views,
        supportId,
        table.table.id
      ).filter((view) => view.name === name);
      assert.equal(
        matches.length,
        1,
        `Expected exactly one saved ${name} view`
      );
      return matches[0].view;
    }
    const built = await run({
      label: 'build-table-and-board-idempotently',
      prompt:
        'In this Support desk database, create a table named AI evaluation with Name (text), Status (select: Todo, Doing, Done), and Points (number). If it already exists reuse its existing columns and options. Ensure exactly these two named records exist once each: Test import, Todo, 3; Verify export, Doing, 5. Update those named records to these values if they already exist; never duplicate them. Save a board named Evaluation board grouped by Status, updating the existing personal view of that name if present. Show both records. Only change this AI evaluation table and its Evaluation board view.',
      schema: querySchema(support, 'Tickets'),
      readonly: false,
      verify: async (answer, completion) => {
        await refreshSupport();
        assert(answer);
        assert.deepEqual(answer.read_tables, [
          tableNamed(support, 'AI evaluation').table.id,
        ]);
        assertRows(await evaluationRows(), [
          ['Test import', 'Todo', 3],
          ['Verify export', 'Doing', 5],
        ]);
        const view = await savedView('Evaluation board');
        assert.equal(view.layout, 'board');
        assert.equal(
          view.groupBy,
          columnNamed(tableNamed(support, 'AI evaluation'), 'Status').column.id
        );
        assert(
          completion.toolActivity.some(
            (entry) => entry.name === 'SaveDatabaseView'
          )
        );
        assertScalar(await ticketCount(), 12);
      },
    });
    if (built || config.selectedCase === 'modify-select-and-save-filtered-view') {
      await run({
        label: 'modify-select-and-save-filtered-view',
        prompt:
          'Only in AI evaluation: set Test import to Done with Points exactly 8. Add a Blocked option to Status only if it is missing, then set Verify export to Blocked, keeping Points 5. Save a personal table view named Needs attention that shows only Status equals Blocked, sorted by Points descending; update that view if it already exists. Show both records after verifying the changes. Do not insert duplicate records or change other tables.',
        schema: querySchema(support, 'AI evaluation'),
        readonly: false,
        verify: async (answer, completion) => {
          await refreshSupport();
          assert(answer);
          assert.deepEqual(answer.read_tables, [
            tableNamed(support, 'AI evaluation').table.id,
          ]);
          assertRows(await evaluationRows(), [
            ['Test import', 'Done', 8],
            ['Verify export', 'Blocked', 5],
          ]);
          const table = tableNamed(support, 'AI evaluation');
          const status = columnNamed(table, 'Status');
          const points = columnNamed(table, 'Points');
          assert(
            status.definition.property_options.some(
              (option) => option.value.value === 'Blocked'
            )
          );
          const view = await savedView('Needs attention');
          assert.equal(view.layout, 'table');
          assert.deepEqual(
            view.filters.map(({ columnId, operator, value }) => ({
              columnId,
              operator,
              value,
            })),
            [
              {
                columnId: status.column.id,
                operator: 'equals',
                value: 'Blocked',
              },
            ]
          );
          assert.deepEqual(view.sorts, [
            { columnId: points.column.id, direction: 'desc' },
          ]);
          assert(
            completion.toolActivity.some(
              (entry) => entry.name === 'SaveDatabaseView'
            )
          );
          assertScalar(await ticketCount(), 12);
        },
      });
    }
    console.log(
      `${entries.filter((entry) => entry.passed).length}/${entries.length} evaluations passed. Report: ${config.output}`
    );
    if (entries.some((entry) => !entry.passed)) process.exitCode = 1;
  } finally {
    await writeReport();
    // Closing a connectOverCDP connection disconnects this runner, not the tab.
    await browser.close();
  }
}

/** Playwright's CDP transport needs Node; Bun only transpiles this entry point. */
async function runUnderNode() {
  const source = fileURLToPath(import.meta.url);
  // Keep the temporary module below node_modules so Node resolves Playwright
  // and the other existing packages without copying or bundling their internals.
  const cache = join(dirname(source), '../node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, 'database-ai-runner-'));
  try {
    const compiled = join(directory, 'database-ai-runner.mjs');
    await promisify(execFile)('bun', [
      'build',
      source,
      '--target=node',
      '--format=esm',
      '--packages=external',
      `--outfile=${compiled}`,
    ]);
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn('node', ['--dns-result-order=ipv4first', compiled, ...process.argv.slice(2)], {
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const config = configuration();
    if (!config.run && !config.seed) {
      console.log(
        'Database AI evaluation: 14 real-model checks for automatic/scoped/general/delegated discovery, joins, totals, bar/pie/line charts, read-only refusal, table creation and saved views.'
      );
      console.log(
        'Use --seed to add missing examples without replacing edits; --run to call models and update only AI evaluation and its two personal views; combine both flags for a fresh fixture. --case <label> reruns one check. No navigation.'
      );
      console.log(
        'Optional environment: DATABASE_AI_EVAL_BASE_URL, DATABASE_AI_EVAL_BACKEND_URL, DATABASE_AI_EVAL_CDP_URL, DATABASE_AI_EVAL_OUTPUT. All endpoints must be local; reports must be under /tmp.'
      );
    } else if (process.versions.bun) {
      await runUnderNode();
    } else {
      await evaluate(config);
    }
  } catch (error) {
    console.error(evaluationError(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
