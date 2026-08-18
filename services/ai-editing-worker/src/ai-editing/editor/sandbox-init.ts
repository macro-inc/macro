/**
 * The snippet that bootstraps a sandbox before the writer's code runs.
 *
 * Shared by every sandbox host so they cannot drift: `src/sandbox.ts` under
 * wrangler, and any other loader that needs the same context (a replay harness
 * is only meaningful while it executes what production executes).
 *
 * The editor implementation and its unknown-method diagnostics are compiled
 * into `SANDBOX_CODE`; this function only serializes per-run data.
 */

/** Build the init source for a sandbox context. */
export function sandboxInit(
  validIds: Iterable<string>,
  refs: string[],
  snippets: Record<string, string> | undefined
): string {
  return [
    `const editor = createDocumentEditor({ validIds: ${JSON.stringify([...validIds])}, refs: ${JSON.stringify(refs)} });`,
    `const snippets = ${JSON.stringify(snippets ?? {})};`,
  ].join('\n');
}
