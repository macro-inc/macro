# Curated code SDK

Code mode embeds a generated, offline SDK in the existing Deno sandbox. It exposes
the real `DocumentEditor`, a private Handlebars instance, and awaited AI calls.
There are no provider credentials or network permissions in agent code.

```ts
const doc = await sdk.documents.open({ documentId });
const { text } = await sdk.ai.generateText({
  model: 'fast',
  prompt: 'Write a one-sentence summary of this document: ' + doc.xml,
});
doc.editor.appendParagraph(
  sdk.templates.render('Summary: {{text}}', { text }, { escape: false })
);
return await doc.save();
```

`await sdk.help()` lists namespaces and examples. The `documents.editor` topic
embeds the editing library's existing API reference. `tools` and exact tool names
query the host's current catalog, so discovery follows the same capability filter
as dispatch. Independent remote calls can use `Promise.all` within the runner's
existing concurrency and time limits. Results and document cards use the existing
awaited code-execution transcript; this adds no streaming protocol.

## Document state and edits

The documents domain requires typed View/Edit authorization receipts and issues
short-lived document-scoped sync tokens. `/code-mode/document` loads the current
Loro snapshot. Reads return full Lexical state, XML, durable node IDs, and an opaque
revision. Edits validate a bounded operation batch against an isolated copy using
the existing Lexical editing library, then send a compare-and-swap delta to sync.
Only a successful acknowledgement counts as a save. An invalid batch or revision
conflict applies nothing. A transport failure can be ambiguous; read again before
retrying instead of replaying a write.

Supported documents are Macro markdown with initialized, persisted node IDs.
The read envelope is limited to 240 KiB; documents to 2000 nodes and depth 64;
saves to 200 operations. Multiplicative edits are bounded before applying them.
Loro uses a fresh random peer for each request. Changes on a handle accumulate
locally until `save()`, which can run once. The returned snapshot is not a live
view, and assigning to it does not mutate the document.

## AI and templates

The agent-code-mode domain admits AI as the session owner and records actual
provider usage. The internal-key-protected worker endpoint uses Vercel AI SDK 6
with server-owned `fast` / `good` aliases, no retries, and a restricted JSON Schema
object output. Provider keys remain in the editing worker. Prompt/system input is
limited to 64 KiB and output to 4096 tokens. Stop returns immediately; already
dispatched completions retain their capacity permit and record usage within a
28-second deadline, with at most 16 such tasks per host. Transport/provider
failures without usage evidence cannot fabricate token counts.

Handlebars runs locally with strict fields, built-in helpers, JSON data, and no
prototype access or helper registration. HTML escaping defaults on; use
`{ escape: false }` for plain document text. Inputs and output have byte limits,
and rendering also runs under the existing Deno memory/time limits.

## Updating and checking

From `services/ai-editing-worker`:

```sh
bun run generate:code-sdk
bun run type-check
bun run test:code-mode
bun run test:spreadsheet
```

Commit both generated outputs: `crates/code_execution/src/outbound/deno/sdk.mjs`
and `crates/agent_code_mode/src/sdk-docs.json`. CI regenerates in memory and rejects
stale artifacts. Deploy the editing worker, runner, and harness together; the new
SDK requires the corresponding host capabilities and worker endpoints. Reuse the
existing worker URL, internal API key, provider configuration, and sync service;
no new secrets or environment variables are introduced.
