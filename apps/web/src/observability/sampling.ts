import { Telemetry } from '@macro-inc/observability';
import { frontendInstanceId } from './frontend-instance';

/**
 * The web app's sampling classes. `perf` is boot, navigation, view and
 * interaction timing; `always` is kept for every user, for spans that must
 * leave a dropped `perf` trace under their own class.
 */
export type SamplingClass = 'always' | 'perf';

declare module '@macro-inc/observability' {
  interface TelemetryRegister {
    samplingClass: SamplingClass;
  }
}

/** Share of production users whose perf traces are exported. */
const PROD_PERF_RATE = 0.05;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Share of users, 0 to 1, whose traces of each class are exported. */
export function samplingRates(
  environment: string
): Record<SamplingClass, number> {
  return {
    always: 1,
    perf: environment === 'prod' ? PROD_PERF_RATE : 1,
  };
}

/**
 * The user, or this document when no one is signed in yet, salted with the
 * week so the sampled cohort rotates.
 */
export function samplingKey(): string {
  const identity = Telemetry.config.userId ?? frontendInstanceId;
  return `${identity}:${Math.floor(Date.now() / WEEK_MS)}`;
}
