# Observability

`Telemetry.init` shares tracing, logs, runtime identity and sampling decisions.
Native startup can register immediately and resolve recording settings and
collector URLs asynchronously.

Sampling is per class and generic: the application passes
`sampling: Record<Class, number>` and a `samplingKey`, and registers its class
names by augmenting `TelemetryRegister`. At enablement each class is kept when
`hash(samplingKey() + class) < rate`; explicit recordings keep every class.
`Telemetry.span(name, { sampling })` puts a span in a class. A span joins its
parent's trace when that trace is exported; otherwise a phase (`span.span`) is
dropped with it, and any other span starts its own trace when its class is
kept (a span without a class always is) and is dropped when it is not. Spans
buffered before enablement are placed at export, moving those that leave a
dropped trace to a new trace id. Every span in a classed trace is exported with
`macro.sampling.class` and `macro.sampling.rate`.

Browser runtimes can supply `exportFetch` independently of their authenticated
application transport. The web app uses its captured webview fetch with omitted
credentials for both trace and log exports, including collectors discovered during
native startup. Collector CORS rules apply; rejected exports never fall back to
the native cookie jar.

The pinned OTLP exporter-base patch adds explicit fetch injection to its browser
transport. It preserves the upstream serializers, retry, timeout, batching and
keepalive rules. The injected fetch takes precedence over global fetch discovery.

Node and Bun processes, such as agent teammates, use `createNodeTracingProvider`
from `@macro-inc/observability/node` as their `tracingProvider`. It registers an
async context manager, so a span's context follows its awaits, and exports to
`tracesUrl`. A span hands on its trace context only after enablement settles:
await `Telemetry.flush()` once after `Telemetry.init` before relying on
`span.traceparent()`.

Run `bun run test` and `bun run type-check` here. `bun run test:browser` exercises
the real browser exporters against a local CORS collector, including startup
recordings, trace/log delivery, retries, cookie omission and CORS refusal. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome if needed.
