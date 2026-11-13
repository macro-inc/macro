/**
 * Telemetry: the agent's spans, through Macro's Telemetry facade. Exported
 * only when the computer gives an OTLP endpoint; otherwise spans are made and
 * dropped. Spans record ids, counts and outcomes, never content.
 */
import { createHash } from 'node:crypto';
import { Telemetry } from '@macro-inc/observability/core';
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

/** The OTel settings a script's process exports with: where, and nothing secret. */
const telemetryVariables = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_DEPLOYMENT_ENVIRONMENT',
] as const;

/** The telemetry settings to hand a child, as they are set here. */
export const telemetryEnvironment = (
  environment: Environment
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    telemetryVariables.flatMap((name) => {
      const value = environment[name];
      return value === undefined || value === '' ? [] : [[name, value]];
    })
  );

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
  await Telemetry.init({
    serviceName,
    environment: environment.OTEL_DEPLOYMENT_ENVIRONMENT ?? 'unset',
    tracesUrl: url,
    resourceAttributes: { 'macro.agent.id': agentTelemetryId(agent) },
    enabled: async () => url !== undefined,
    tracingProvider: (resource, getUserId, sampling) =>
      createServerTracingProvider(
        { tracesUrl: url },
        resource,
        getUserId,
        sampling
      ),
  });
};

/** The agent's `Trace` port over the facade. */
export const trace: Trace = (name, run) =>
  Telemetry.span(name, (span) =>
    run({
      set: (key, value) => span.setAttr(key, value),
      traceparent: () => span.traceparent(),
    })
  );

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
