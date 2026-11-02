import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  type Attributes,
  type LogAttributes,
  type TelemetryInitConfig,
  TelemetryRuntimeConfig,
} from './config';
import { ATTR_DEPLOYMENT_ENVIRONMENT, CONSOLE_PREFIX } from './constants';
import { Logging } from './logging';
import type { Span, TraceContext } from './span';
import { Tracing } from './tracing';

type SpanOperation<T> = (span: Span) => Promise<T>;

export class Telemetry {
  static readonly #tracing = new Tracing();
  static readonly #logging = new Logging();
  static #initialization: Promise<void> | undefined;

  private constructor() {}

  static readonly config = new TelemetryRuntimeConfig();

  /** Initialize providers once, with an optional buffer while enablement resolves. */
  static init(config: TelemetryInitConfig): Promise<void> {
    Telemetry.#initialization ??= Telemetry.#initialize(config);
    return Telemetry.#initialization;
  }

  static span<T>(name: string, operation: SpanOperation<T>): Promise<T>;
  static span(name: string): Span;
  static span<T>(
    name: string,
    operation?: SpanOperation<T>
  ): Span | Promise<T> {
    return Telemetry.#runSpan(Telemetry.#tracing.span(name), operation);
  }

  /**
   * Start telemetry whose complete span tree is forbidden from receiving the
   * runtime user-id enrichment. Use this for privacy-aggregated subsystem
   * metrics whose schema does not permit identity.
   */
  static anonymousSpan<T>(
    name: string,
    operation: SpanOperation<T>
  ): Promise<T>;
  static anonymousSpan(name: string): Span;
  static anonymousSpan<T>(
    name: string,
    operation?: SpanOperation<T>
  ): Span | Promise<T> {
    return Telemetry.#runSpan(
      Telemetry.#tracing.anonymousSpan(name),
      operation
    );
  }

  /**
   * Start a span whose trace is performance telemetry: the web sampler keeps
   * it for a fixed share of sessions. Inside an active span it is a child and
   * follows that trace's sampling.
   */
  static perfSpan(name: string, startTime?: number): Span {
    return Telemetry.#tracing.perfSpan(name, startTime);
  }

  /** Start a historical phase at Unix time in milliseconds. */
  static spanAt(name: string, startTime: number): Span {
    return Telemetry.#tracing.span(name, startTime);
  }

  /**
   * Capture at synchronous transport/queue admission, before its first await.
   * Prefer a known Span directly; a captured context creates/ends no span.
   */
  static captureContext(): TraceContext {
    return Telemetry.#tracing.captureContext();
  }

  /** Start an HTTP client span. Callers must end the returned span. */
  static clientSpan(name: string): Span {
    return Telemetry.#tracing.clientSpan(name);
  }

  /** Record a point-in-time sample; timestamp is Unix time in milliseconds. */
  static recordSample(
    name: string,
    attributes: Attributes,
    timestamp: number
  ): void {
    Telemetry.#tracing.recordSample(name, attributes, timestamp);
  }

  static debug(message: string, attributes?: LogAttributes): void {
    Telemetry.#logging.debug(message, attributes);
  }

  static info(message: string, attributes?: LogAttributes): void {
    Telemetry.#logging.info(message, attributes);
  }

  static warn(message: string, attributes?: LogAttributes): void {
    Telemetry.#logging.warn(message, attributes);
  }

  static error(error: unknown, attributes?: LogAttributes): void {
    Telemetry.#logging.error(error, attributes);
  }

  static async flush(): Promise<void> {
    await Promise.all([Telemetry.#tracing.flush(), Telemetry.#logging.flush()]);
  }

  static async shutdown(): Promise<void> {
    await Promise.all([
      Telemetry.#tracing.shutdown(),
      Telemetry.#logging.shutdown(),
    ]);
  }

  static #runSpan<T>(
    span: Span,
    operation?: SpanOperation<T>
  ): Span | Promise<T> {
    if (!operation) return span;

    return span.run(async () => {
      try {
        return await operation(span);
      } finally {
        span.end();
      }
    });
  }

  static async #initialize(config: TelemetryInitConfig): Promise<void> {
    // A single shared decision gates both the buffered tracing exporter and logs.
    const enabled = Telemetry.#enabled(config);
    const tracingConfig = { ...config, enabled: () => enabled };
    const resource = resourceFromAttributes({
      ...config.resourceAttributes,
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment,
    });
    const getUserId = () => Telemetry.config.userId;
    Telemetry.config.decidePerfSampling(
      config.recording ? 1 : (config.perfSampleRate ?? 1)
    );
    Telemetry.#tracing.init(
      tracingConfig,
      resource,
      getUserId,
      Telemetry.config.perfSampled
    );
    if (!(await enabled)) return;
    const resolved = config.startup
      ? { ...config, ...(await config.startup) }
      : config;
    Telemetry.#logging.init(resolved, resource, getUserId);
  }
  static async #enabled(config: TelemetryInitConfig): Promise<boolean> {
    try {
      const [enabled] = await Promise.all([config.enabled(), config.startup]);
      return enabled;
    } catch (error) {
      console.warn(`${CONSOLE_PREFIX} Failed to resolve enablement`, error);
      return false;
    }
  }
}
