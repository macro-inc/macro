import type {
  ContextManager,
  AttributeValue as OtelAttributeValue,
} from '@opentelemetry/api';
import type { DetectedResourceAttributes } from '@opentelemetry/resources';
import type { TelemetryTracingProviderFactory } from './provider';
import type { SamplingClass, TraceSampling } from './sampling';

export type Attribute = OtelAttributeValue;
export type Attributes = Record<string, Attribute | undefined>;
export type LogAttributes = Attributes;
export type ResourceAttributes = DetectedResourceAttributes;

/** Native diagnostic settings discovered after the tracing provider registers. */
export interface TelemetryStartupOptions {
  tracesUrl?: string;
  logsUrl?: string;
  recording: boolean;
}

/**
 * Per-class sampling. Each class is kept for a share of users, decided once
 * per user per class at enablement; spans that ask for no class are kept.
 */
export type TelemetrySamplingConfig<Classes extends string> =
  | {
      /** Share of users, 0 to 1, whose traces of each class are exported. */
      sampling: Readonly<Record<Classes, number>>;
      /** The stable identity a decision is made for, read at enablement. */
      samplingKey: () => string;
    }
  | { sampling?: undefined; samplingKey?: undefined };

export type TelemetryInitConfig<Classes extends string = SamplingClass> =
  TelemetryBaseConfig & TelemetrySamplingConfig<Classes>;

interface TelemetryBaseConfig {
  serviceName: string;
  environment: string;
  tracesUrl?: string;
  logsUrl?: string;
  contextManager?: ContextManager;
  /** Browser export transport, independent of authenticated application HTTP. */
  exportFetch?: (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ) => Promise<Response>;
  tracingProvider?: TelemetryTracingProviderFactory;
  /** Stable identity shared by this runtime's traces and logs. */
  resourceAttributes?: ResourceAttributes;
  /** Snapshot of live diagnostics, read synchronously at span start/end. */
  spanAttributes?: () => Attributes;
  /** Explicit diagnostic recordings keep every sampling class. */
  recording?: boolean;
  /** Resolve exporter and recording settings without blocking provider registration. */
  startup?: Promise<TelemetryStartupOptions>;
  enabled: () => Promise<boolean>;
}

/** Mutable attributes applied to telemetry created after they change. */
export class TelemetryRuntimeConfig {
  #userId: string | undefined;
  readonly #sampling: TraceSampling;

  constructor(sampling: TraceSampling) {
    this.#sampling = sampling;
  }

  /**
   * Whether this runtime exports traces of a sampling class. False until the
   * class is decided at enablement, and while telemetry is disabled.
   */
  sampled(samplingClass: SamplingClass): boolean {
    return this.#sampling.kept(samplingClass) === true;
  }

  get userId(): string | undefined {
    return this.#userId;
  }

  setUser(userId: string | undefined): void {
    this.#userId = userId;
  }
}
