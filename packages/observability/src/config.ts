import type {
  ContextManager,
  AttributeValue as OtelAttributeValue,
} from '@opentelemetry/api';
import type { DetectedResourceAttributes } from '@opentelemetry/resources';
import type { TelemetryTracingProviderFactory } from './provider';

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

export interface TelemetryInitConfig {
  serviceName: string;
  environment: string;
  tracesUrl?: string;
  logsUrl?: string;
  contextManager?: ContextManager;
  /** Browser export transport, independent of authenticated application HTTP. */
  exportFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response>;
  tracingProvider?: TelemetryTracingProviderFactory;
  /** Stable identity shared by this runtime's traces and logs. */
  resourceAttributes?: ResourceAttributes;
  /** Snapshot of live diagnostics, read synchronously at span start/end. */
  spanAttributes?: () => Attributes;
  /** Share of sessions, 0 to 1, whose perf-class traces are exported. */
  perfSampleRate?: number;
  /** Explicit diagnostic recordings capture all emitted spans. */
  recording?: boolean;
  /** Resolve exporter and recording settings without blocking provider registration. */
  startup?: Promise<TelemetryStartupOptions>;
  enabled: () => Promise<boolean>;
}

/** Mutable attributes applied to telemetry created after they change. */
export class TelemetryRuntimeConfig {
  #userId: string | undefined;
  #perfSampled = true;

  /**
   * The normal perf sampling decision, shared by all runtime providers.
   * Explicit recordings override it, including recordings resolved during
   * native startup. Do not gate early recording capture on this value.
   */
  get perfSampled(): boolean {
    return this.#perfSampled;
  }

  decidePerfSampling(rate: number): void {
    this.#perfSampled = Math.random() < rate;
  }

  get userId(): string | undefined {
    return this.#userId;
  }

  setUser(userId: string | undefined): void {
    this.#userId = userId;
  }
}
