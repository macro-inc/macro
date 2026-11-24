/**
 * The solver's only tools, as a stdio MCP server for the one OpenCode run
 * `solveCaptcha` starts: `detect_captcha` and `solve_captcha`, both on the
 * agent's current tab. It holds no key: solves go through the agent's relay,
 * whose capability it is given. Every outcome is also written to the record
 * file, which is what `solveCaptcha` reports, never the model's own words.
 *
 * Run as `bun mcp.ts`, with the variables in {@link mcpVariables}.
 */
import { appendFile } from 'node:fs/promises';
import { Telemetry } from '@macro-inc/observability/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  startTelemetryAs,
  trace,
  traceparentVariable,
  underParent,
} from '../../context/telemetry.ts';
import { ownerDriving, readOrMissing } from '../browser/driver.ts';
import { withCurrentPage, withTargetPage } from './page.ts';
import { findChallenge, type Outcome, solveOnPage } from './solve.ts';

/** What the server is started with. */
export const mcpVariables = {
  relayUrl: 'MUPPET_RELAY_URL',
  relayToken: 'MUPPET_RELAY_TOKEN',
  browser: 'MUPPET_BROWSER_CDP_URL',
  /** The harness's solver run: every solve carries it. Each attempt is a solve of its own, with a fresh UUID the harness dedupes on. */
  runId: 'CAPTCHA_RUN_ID',
  /** Where each outcome is appended, one JSON line per attempt. */
  record: 'CAPTCHA_RECORD_FILE',
  /** The harness's take-over file: while the owner drives, the solver touches nothing. */
  screenDriver: 'CAPTCHA_SCREEN_DRIVER_FILE',
  /** The agent's opaque telemetry id (`agentTelemetryId`), for the spans' resource. */
  agentId: 'CAPTCHA_AGENT_TELEMETRY_ID',
  /** The `captcha.opencode_run` span every tool call runs under. */
  traceparent: traceparentVariable,
} as const;

/** Most solves one run may ask for. */
export const mostAttempts = 2;

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(`${name} is not set`);
  return value;
};

/** One recorded attempt. */
export type Recorded = { readonly attempt: number; readonly outcome: Outcome };

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

/** How long a tool call waits for its spans to export: an unreachable collector must not hold up the answer. */
const flushLimitMs = 2_000;

/**
 * One tool call as a span under the run's, exported before it answers:
 * OpenCode may stop the server as soon as the run ends.
 */
const traced = async <Value>(
  name: string,
  runId: string,
  run: () => Promise<Value>
): Promise<Value> => {
  try {
    return await underParent(process.env, () =>
      trace(name, (span) => {
        span.set('captcha.run_id', runId);
        return run();
      })
    );
  } finally {
    await Promise.race([Telemetry.flush(), Bun.sleep(flushLimitMs)]);
  }
};

export const startServer = async (): Promise<void> => {
  const relay = {
    url: required(mcpVariables.relayUrl),
    token: required(mcpVariables.relayToken),
  };
  const endpoint = required(mcpVariables.browser);
  const runId = required(mcpVariables.runId);
  const record = required(mcpVariables.record);
  const screenDriver = required(mcpVariables.screenDriver);
  const ownerDrivingNow = async () =>
    ownerDriving(await readOrMissing(screenDriver));
  const withPage = <Value>(use: Parameters<typeof withCurrentPage<Value>>[1]) =>
    withCurrentPage(endpoint, use);
  const withTarget = <Value>(
    targetId: string,
    use: Parameters<typeof withCurrentPage<Value>>[1]
  ) => withTargetPage(endpoint, targetId, use);
  let attempts = 0;
  await startTelemetryAs({
    environment: process.env,
    agentId: process.env[mcpVariables.agentId] ?? 'unknown',
  });

  const server = new McpServer({ name: 'captcha', version: '1.0.0' });
  server.registerTool(
    'detect_captcha',
    {
      description:
        "Detects the human check on the browser's current tab without touching it: its kind, or noChallenge, or unsupported with the provider.",
    },
    () =>
      traced('captcha.tool.detect', runId, async () => {
        const found = await withPage(findChallenge);
        return text(
          'challenge' in found
            ? { outcome: 'found', kind: found.challenge.kind }
            : found
        );
      })
  );
  server.registerTool(
    'solve_captcha',
    {
      description: `Solves the human check on the current tab and reports what the page did after. At most ${mostAttempts} calls per run; call again only after unsolvable, timeout or stillChallenged.`,
    },
    () =>
      traced('captcha.tool.solve', runId, async () => {
        if (attempts >= mostAttempts)
          return text({ outcome: 'attemptsUsed', most: mostAttempts });
        attempts += 1;
        const outcome = await solveOnPage(
          {
            withPage,
            withTarget,
            relay,
            fetch: (request) => fetch(request),
            trace,
            ownerDriving: ownerDrivingNow,
          },
          { solveId: crypto.randomUUID(), runId }
        );
        const line: Recorded = { attempt: attempts, outcome };
        await appendFile(record, `${JSON.stringify(line)}\n`);
        return text(outcome);
      })
  );
  await server.connect(new StdioServerTransport());
};

if (import.meta.main) await startServer();
