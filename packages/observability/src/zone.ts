// Importing context-zone loads zone.js, which patches Promise & friends as a
// module side effect, quarantined in its own entry so it never rides into
// non-browser consumers. Hosts must import this statically at startup: patching
// lazily is unreliable, since context would not flow through Promises created
// before the patch.
export { ZoneContextManager } from "@opentelemetry/context-zone";
