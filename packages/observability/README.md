# Observability

`Telemetry.init` shares tracing, logs, runtime identity and the session sampling
decision. Native startup can register immediately and resolve recording settings
and collector URLs asynchronously.

Browser runtimes can supply `exportFetch` independently of their authenticated
application transport. The web app uses its captured webview fetch with omitted
credentials for both trace and log exports, including collectors discovered during
native startup. Collector CORS rules apply; rejected exports never fall back to
the native cookie jar.

The pinned OTLP exporter-base patch adds explicit fetch injection to its browser
transport. It preserves the upstream serializers, retry, timeout, batching and
keepalive rules. The injected fetch takes precedence over global fetch discovery.

Run `bun run test` and `bun run type-check` here. `bun run test:browser` exercises
the real browser exporters against a local CORS collector, including startup
recordings, trace/log delivery, retries, cookie omission and CORS refusal. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome if needed.
