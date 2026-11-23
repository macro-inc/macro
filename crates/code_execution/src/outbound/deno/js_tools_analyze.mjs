// The JS tools analyzer as a process, for the agent permissions gate: what a
// program may call, without running it. Nothing here runs the program.
//
// Its directory holds this file, js-tools.mjs and js-tools.json
// (code_mode_assets::{JS_TOOLS, JS_TOOLS_CATALOG}): the same bundle and
// catalog a run analyzes the program with again, so both answers agree.
// Run it with no network and no credential:
//
//   deno run --no-prompt --no-config --no-lock --no-remote --no-npm
//     --deny-write --deny-env --deny-run --deny-ffi --deny-sys --deny-import
//     --deny-net --allow-read=<its directory> analyze.mjs
//
// stdin: the program's source, UTF-8, to the end.
// stdout: one line of JSON, `analyze`'s answer (js-tools.mjs):
//
//   {"status":"ok","operations":[{"path","service","operation","method","route","rivals":[{"service","route"}]}]}
//   {"status":"cannot_analyze","reasons":[{"message","location":{"line","column"}}]}
//   {"status":"diagnostics","diagnostics":[{"message","location"?:{"line","column"}}]}
//
// `operation` is the raw operationId (the registry key with `service`),
// `route` the path below the service's host with `{}` for each parameter;
// lines are 1-based and columns 0-based. Exit status 0 with that line, or
// nonzero on an infrastructure failure.
import { analyze, toolsByPath } from "./js-tools.mjs";

const source = await new Response(Deno.stdin.readable).text();
const catalog = JSON.parse(Deno.readTextFileSync(new URL("./js-tools.json", import.meta.url)));
const answer = new TextEncoder().encode(`${JSON.stringify(analyze(source, toolsByPath(catalog)))}\n`);
let written = 0;
while (written < answer.length) written += Deno.stdout.writeSync(answer.subarray(written));
