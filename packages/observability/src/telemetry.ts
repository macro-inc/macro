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
import { keepsClass, type SamplingClass, TraceSampling } from './sampling';
import type { Span, TraceContext } from './span';
import { type SpanOptions, Tracing } from './tracing';

type SpanOperation<T> = (span: Span) => Promise<T>;

export class Telemetry {
  static readonly #tracing = new Tracing();
  static readonly #logging = new Logging();
  static readonly #sampling = new TraceSampling();
  static #initialization: Promise<void> | undefined;

  private constructor() {}

  static readonly config = new TelemetryRuntimeConfig(Telemetry.#sampling);

  /** Initialize providers once, with an optional buffer while enablement resolves. */
  static init<Classes extends string = SamplingClass>(
    config: TelemetryInitConfig<Classes>
  ): Promise<void> {
    Telemetry.#initialization ??= Telemetry.#initialize(config);
    return Telemetry.#initialization;
  }

  /**
   * Start a span in the active trace. When that trace is dropped by sampling,
   * the span starts its own trace if its `sampling` class is kept (always,
   * without one) and is dropped otherwise.
   */
  static span<T>(name: string, operation: SpanOperation<T>): Promise<T>;
  static span<T>(
    name: string,
    options: SpanOptions,
    operation: SpanOperation<T>
  ): Promise<T>;
  static span(name: string, options?: SpanOptions): Span;
  static span<T>(
    name: string,
    optionsOrOperation?: SpanOptions | SpanOperation<T>,
    operation?: SpanOperation<T>
  ): Span | Promise<T> {
    if (typeof optionsOrOperation === 'function')
      return Telemetry.#runSpan(
        Telemetry.#tracing.span(name),
        optionsOrOperation
      );
    return Telemetry.#runSpan(
      Telemetry.#tracing.span(name, optionsOrOperation),
      operation
    );
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
   * Capture at synchronous transport/queue admission, before its first await.
   * Prefer a known Span directly; a captured context creates/ends no span.
   */
  static captureContext(): TraceContext {
    return Telemetry.#tracing.captureContext();
  }

  /**
   * The trace another service started, for work it asked for over a transport
   * without headers. Spans started in it join that trace. A malformed value
   * starts a new trace instead.
   */
  static remoteContext(traceparent: string): TraceContext {
    return Telemetry.#tracing.remoteContext(traceparent);
  }

  /** Record a point-in-time sample; timestamp is Unix time in milliseconds. */
  static recordSample(
    name: string,
    attributes: Attributes,
    timestamp: number,
    sampling?: SamplingClass
  ): void {
    Telemetry.#tracing.recordSample(name, attributes, timestamp, sampling);
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

  static async #initialize<Classes extends string>(
    config: TelemetryInitConfig<Classes>
  ): Promise<void> {
    // A single shared decision gates both the buffered tracing exporter and logs.
    const enabled = Telemetry.#enabled(config);
    const tracingConfig = { ...config, enabled: () => enabled };
    const resource = resourceFromAttributes({
      ...config.resourceAttributes,
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment,
    });
    const getUserId = () => Telemetry.config.userId;
    const sampling = Telemetry.#sampling;
    sampling.configure(config.sampling ?? {});
    Telemetry.#tracing.init(tracingConfig, resource, getUserId, sampling);
    const allowed = await enabled;
    const resolved =
      allowed && config.startup
        ? { ...config, ...(await config.startup) }
        : config;
    // Decided at enablement: spans buffered until now are placed at export.
    const key = allowed ? config.samplingKey?.() : undefined;
    sampling.decide(
      (samplingClass, rate) =>
        allowed &&
        (resolved.recording === true ||
          key === undefined ||
          keepsClass(key, samplingClass, rate))
    );
    if (!allowed) return;
    Telemetry.#logging.init(resolved, resource, getUserId);
  }
  static async #enabled<Classes extends string>(
    config: TelemetryInitConfig<Classes>
  ): Promise<boolean> {
    try {
      const [enabled] = await Promise.all([config.enabled(), config.startup]);
      return enabled;
    } catch (error) {
      console.warn(`${CONSOLE_PREFIX} Failed to resolve enablement`, error);
      return false;
    }
  }
}
