// Stand-in for the `cloudflare:workers` module, which only exists in workerd.
// @microlabs/otel-cf-workers imports it at module scope, so Node-based tests
// alias it here (see vitest.config.ts) to be able to import src/worker.ts.
export class DurableObject {}
