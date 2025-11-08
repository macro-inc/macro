

 /** A script to use AI to update logs.
 *
 * Depends on: claude code, bun
 * *WARNING* commit all work before using
 */

import { readdir } from "node:fs/promises";
import { join } from 'node:path';
import { $ } from 'bun';


let instructions = `
  # Info
  This binary provides AI services to a webapp. Logging uses the Rust \`tracing\` crate with a JSON subscriber consumed by Datadog.

  # Rules
  Update the logging according to the following rules

  - Only values that implement \`Display can be logged\`
  - Instrument every **fallible** function with \`#[tracing::instrument(err, ...)]\`.
  - Do **not** instrument infallible functions.
  - Use \`err\` (not \`err(Debug)\`) so errors are logged as structured events.
  - Skip large or sensitive arguments in the \`instrument\` macro (e.g., bodies, chat contents, file contents).
  - user_ids are not sensitive
  - Read struct definitions when instrumenting functions so that you can choose to log the whole struct, part of the struct, or none of the struct as appropriate
  - Http handlers and WebSocket handlers should be instrumented but should _not_ log return values (use #[tracing::instrument(...,)] not #[tracing::instrument(..., err)])
  - If a function involves large inputs, use \`#[tracing::instrument(skip(...))]\` or \`#[tracing::instrument(skip_all)]\` as appropriate

  - When returning errors with \`?\`, attach \`anyhow::Context\` with a short description of what was attempted.
    - Import the \`Context\` trait from anyhow and attach context to anyhow errors with \`.context(<description>) --example--> .context("failed to fetch chat attachment")\`
  - When transforming an \`anyhow::Error\` into an HTTP or WebSocket error, log the original error before conversion with \`tracing::error!(err)\`
  - Do not use \`with_context\` use \`.context\`
  - Do not use \`format!\` in \`.context\`. Context should only ever attach a static string.
  - Do not emit an error log that contains the same information or fields that will be emited by the parent span
  - Prefer the instrument macro over manually logging errors with \`tracing::error!(...)\` except at error boundries where a manual log should be used

  - Replace all \`print!\`/\`println!\` calls with structured \`tracing\` events.
  - info, error, and warn events are recorded in production, trace, and debug events are not so they should be left unedited as they are placed by devs for ease of future
    debugging

  # Instructions
  Only edit the file you are told to

  Only update logging code

  Do not prepend or append your changes with any summary description or thoughts. Just make
  the changes. Use Read and Edit as needed.

  If no changes are needed say nothing and exit
`;


class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = []
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
    } else {
      await new Promise((resolve) => this.queue.push(resolve))
      this.current ++;
    }
  }

  async release() {
    this.current--;
    const resolve = this.queue.shift();
    if (resolve) resolve();
  }
}


const workers = new Semaphore(32);

for (const file of await readdir("./src", { recursive: true, withFileTypes: true})) {
  if (file.isDirectory() || !file.name.endsWith(".rs"))
    continue;
  const path = join(file.parentPath, file.name);
  updateLogs(path);
}

async function updateLogs(file) {
  await workers.acquire();
  try {
    console.log("UPDATING ...", file)
    const out = await $`claude "${instructions}\nUpdate this file ${file}" --dangerously-skip-permissions`
    console.log("UPDATED ...", file, out.exitCode === 0 ? "Ok" : "Err");
  } finally {
    workers.release();

}
