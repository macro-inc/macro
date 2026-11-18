export type {
  Attribute,
  Attributes,
  LogAttributes,
  ResourceAttributes,
  TelemetryInitConfig,
  TelemetryStartupOptions,
} from './config';
export { TelemetryRuntimeConfig } from './config';
export type { SamplingClass, TelemetryRegister } from './sampling';
export type { Span, TraceContext } from './span';
export { NOOP_SPAN } from './span-noop';
export { Telemetry } from './telemetry';
export type { SpanOptions } from './tracing';
