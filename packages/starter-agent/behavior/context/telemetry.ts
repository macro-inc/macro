/**
 * Telemetry: the agent's spans, through Macro's Telemetry facade. Exported
 * only when the computer gives an OTLP endpoint; otherwise spans are made and
 * dropped. Spans record ids, counts and outcomes, never content.
 */
import { createHash } from 'node:crypto';
import { type Span, Telemetry } from '@macro-inc/observability/core';
import { createServerTracingProvider } from '@macro-inc/observability/server';
import type { Trace } from '../agent/claude.ts';

type Environment = Readonly<Record<string, string | undefined>>;

const serviceName = 'macro-agent';
const tracesPath = '/v1/traces';
/** Where a script's process finds the span it runs under. */
export const traceparentVariable = 'TRACEPARENT';

/** The OTLP traces URL the environment names, if any (standard OTel variables). */
export const tracesUrl = (environment: Environment): string | undefined => {
  const traces = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (traces !== undefined && traces !== '') return traces;
  const base = environment.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base === undefined || base === '') return undefined;
  return `${base.replace(/\/+$/, '')}${tracesPath}`;
};

/**
 * The export's extra headers, from the standard `OTEL_EXPORTER_OTLP_HEADERS`
 * (`key=value,…`, values URL-encoded): the image names the computer there,
 * for a per-computer limit at the intake. A malformed entry is skipped.
 */
export const tracesHeaders = (
  environment: Environment
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (environment.OTEL_EXPORTER_OTLP_HEADERS ?? '')
      .split(',')
      .flatMap((entry) => {
        const [, key, value] =
          /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(entry) ?? [];
        if (key === undefined || value === undefined || value === '') return [];
        try {
          return [[key.toLowerCase(), decodeURIComponent(value)]];
        } catch {
          return [];
        }
      })
  );

/** The OTel settings a script's process exports with: where, and nothing secret. */
const telemetryVariables = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_DEPLOYMENT_ENVIRONMENT',
] as const;

/** The one export header a script gets: the computer's name, never a credential. */
const computerHeader = 'x-macro-computer-id';

/**
 * The telemetry settings to hand a child, as they are set here. Of the export
 * headers only the computer's passes, so an `Authorization` header set for a
 * self-hosted collector never reaches a script.
 */
export const telemetryEnvironment = (
  environment: Environment
): Readonly<Record<string, string>> => {
  const computer = tracesHeaders(environment)[computerHeader];
  return Object.fromEntries([
    ...telemetryVariables.flatMap((name) => {
      const value = environment[name];
      return value === undefined || value === '' ? [] : [[name, value]];
    }),
    ...(computer === undefined
      ? []
      : [
          [
            'OTEL_EXPORTER_OTLP_HEADERS',
            `${computerHeader}=${encodeURIComponent(computer)}`,
          ],
        ]),
  ]);
};

/** An opaque id for the agent's account, which is an email: never record it as is. */
export const agentTelemetryId = (agent: string): string =>
  createHash('sha256').update(agent).digest('hex').slice(0, 16);

/** Starts the agent's telemetry, once per process. */
export const startTelemetry = async ({
  environment,
  agent,
}: {
  readonly environment: Environment;
  readonly agent: string;
}): Promise<void> => {
  const url = tracesUrl(environment);
  // No sampling: no class is configured, so every span the agent makes (a
  // wake, a reply run, a task, a script, its Macro calls) is exported.
  await Telemetry.init({
    serviceName,
    environment: environment.OTEL_DEPLOYMENT_ENVIRONMENT ?? 'unset',
    tracesUrl: url,
    resourceAttributes: { 'macro.agent.id': agentTelemetryId(agent) },
    enabled: async () => url !== undefined,
    tracingProvider: (resource, getUserId, sampling) =>
      createServerTracingProvider(
        { tracesUrl: url, tracesHeaders: tracesHeaders(environment) },
        resource,
        getUserId,
        sampling
      ),
  });
};

/** The agent's `Trace` port over the facade. */
export const trace: Trace = (name, run, parent) => {
  const start = () =>
    Telemetry.span(name, (span) =>
      run({
        set: (key, value) => span.setAttr(key, value),
        traceparent: () => span.traceparent(),
      })
    );
  return parent === undefined || parent === ''
    ? start()
    : Telemetry.remoteContext(parent).run(start);
};

/** Where the image puts the computer's setup trace, so the agent's start joins it. */
export const setupTraceparentVariable = 'MACRO_SETUP_TRACEPARENT';

/** Where the image's launcher (`start-agent`) passes the times of its steps. */
export const launchTimingsVariable = 'MACRO_LAUNCH_TIMINGS';

/** The launcher's run, in Unix milliseconds: from its start to its exec of the runtime. */
export type LaunchTimings = {
  readonly started: number;
  readonly steps: readonly {
    readonly name: string;
    readonly start: number;
    readonly end: number;
  }[];
  readonly ended: number;
};

const microseconds = (digits: string): number => Number(digits) / 1000;

/**
 * Reads the launcher's timings, `started:<µs>,<step>:<µs>:<µs>,…,exec:<µs>`
 * (Unix microseconds, bash's EPOCHREALTIME). Anything else is ignored: the
 * start is then timed from the process alone.
 */
export const launchTimings = (
  raw: string | undefined
): LaunchTimings | undefined => {
  const items = (raw ?? '').split(',');
  const first = /^started:(\d+)$/.exec(items[0] ?? '');
  const last = /^exec:(\d+)$/.exec(items.at(-1) ?? '');
  if (first?.[1] === undefined || last?.[1] === undefined || items.length < 2)
    return undefined;
  const steps = items.slice(1, -1).map((item) => {
    const [, name, start, end] = /^([a-z_]+):(\d+):(\d+)$/.exec(item) ?? [];
    return name === undefined || start === undefined || end === undefined
      ? undefined
      : { name, start: microseconds(start), end: microseconds(end) };
  });
  if (steps.some((step) => step === undefined)) return undefined;
  return {
    started: microseconds(first[1]),
    steps: steps.filter((step) => step !== undefined),
    ended: microseconds(last[1]),
  };
};

/** The launcher's run as `agent.launch`, a child of the active span, with a child per step. */
const recordLaunch = ({ started, steps, ended }: LaunchTimings): void => {
  const launch = Telemetry.span('agent.launch', { startTime: started });
  launch.run(() => {
    for (const { name, start, end } of steps)
      Telemetry.span(`agent.launch.${name}`, { startTime: start }).end(end);
  });
  launch.end(ended);
};

/** Times one step of the agent's start as a child span of it. */
export type StartPhase = <Value>(
  name: string,
  run: () => Promise<Value>
) => Promise<Value>;

/** Runs `run`, marking `span` failed when it throws, so a failed start exports as one. */
const failing = async <Value>(
  span: Span,
  run: () => Promise<Value>
): Promise<Value> => {
  try {
    return await run();
  } catch (error) {
    span.error(error);
    throw error;
  }
};

/** A step of the start that ran before its span could: from `start` (the process's start when absent) to `end`, Unix ms. */
export type EarlierStep = {
  readonly name: string;
  readonly start?: number;
  readonly end: number;
};

/**
 * Runs the agent's start as one `agent.start` span, from the launcher's start
 * when it passes its timings (its steps become `agent.launch.*`), otherwise
 * from the process's own start (so loading the code counts), under the
 * computer's setup trace when the image passes one. Work begun inside, such as the greeting, joins it;
 * the event loop must start outside (a context captured before this), so
 * each wake stays a trace of its own.
 */
export const traceStart = <Value>(
  environment: Environment,
  run: (phase: StartPhase) => Promise<Value>,
  earlier: readonly EarlierStep[] = []
): Promise<Value> => {
  const processStart = Date.now() - process.uptime() * 1000;
  const launch = launchTimings(environment[launchTimingsVariable]);
  const start = () =>
    Telemetry.span(
      'agent.start',
      { startTime: launch?.started ?? processStart },
      (span) => {
        // The launcher's steps, then those in this process that ran before
        // telemetry could record them, backdated.
        if (launch !== undefined) recordLaunch(launch);
        for (const step of earlier)
          Telemetry.span(step.name, {
            startTime: step.start ?? processStart,
          }).end(step.end);
        return failing(span, () =>
          run((name, step) => span.span(name, (child) => failing(child, step)))
        );
      }
    );
  const traceparent = environment[setupTraceparentVariable];
  return traceparent === undefined || traceparent === ''
    ? start()
    : Telemetry.remoteContext(traceparent).run(start);
};

/** Runs `run` under the span a parent process passed in TRACEPARENT, if any. */
export const underParent = <Value>(
  environment: Environment,
  run: () => Promise<Value>
): Promise<Value> => {
  const traceparent = environment[traceparentVariable];
  return traceparent === undefined || traceparent === ''
    ? run()
    : Telemetry.remoteContext(traceparent).run(run);
};
