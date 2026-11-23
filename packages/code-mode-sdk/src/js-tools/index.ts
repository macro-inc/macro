/**
 * `js-tools.mjs`: what Deno loads to analyze and run JS tools programs, in
 * `@opencode/codemode`'s JavaScript dialect. The bootstrap
 * (`crates/code_execution/src/outbound/deno/bootstrap.mjs`) runs programs
 * with it; `crates/code_execution/src/outbound/deno/js_tools_analyze.mjs`
 * analyzes them for the agent permissions gate. Both read the catalog from
 * `js-tools.json`. It carries no SDK and no credential: the bootstrap passes
 * in the function that sends each call.
 */

export type {
  Analysis,
  AnalyzedOperation,
  Location,
  ParseDiagnostic,
  Refusal,
} from './analyze';
export { analyze, toolsByPath } from './analyze';
export type { Catalog, CatalogTool, Route } from './catalog';
export type {
  Bindings,
  CallTool,
  ModuleBridge,
  Runtime,
  ToolInput,
} from './runtime';
export { makeRuntime } from './runtime';
