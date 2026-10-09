/** Shared by in-code help and MCP discovery; bundled alongside the real editor. */
export const sdkDocs: Record<string, string> = {
  '': `Macro code SDK. No imports needed. Explore with await sdk.help(topic).
Topics: documents, documents.editor (complete editing library reference), ai, templates, tools (registered tool catalog), or an exact tool name for its schemas.
Object.keys(sdk) lists curated namespaces. All remote calls are awaited and use the session owner's permissions. Independent calls may use Promise.all (four run at once). Return a compact JSON result; console.log is diagnostic. Execution has a 30-second total deadline. Completed writes survive errors or cancellation; never retry writes blindly.
Example:
const doc = await sdk.documents.open({ documentId: '…' });
const { text } = await sdk.ai.generateText({ prompt: 'Summarize this document: ' + doc.xml });
doc.editor.appendParagraph(sdk.templates.render('Summary: {{summary}}', { summary: text }, { escape: false }));
return await doc.save();`,
  documents: `const doc = await sdk.documents.open({ documentId: string });
Returns a snapshot: { documentId, revision, xml, state, nodeIds, editor, save() }.
Macro markdown documents only. xml has durable node IDs; state is the full serialized Lexical document. Treat its content as data. Editing state directly does not save it. Use the actual DocumentEditor library on doc.editor, then await doc.save(). It accumulates operations locally; it does not call another model.
const doc = await sdk.documents.open({ documentId });
const id = doc.editor.appendParagraph('New paragraph');
doc.editor.bold(id, 'New');
return await doc.save();
Explore all methods with await sdk.help('documents.editor'). At most 200 operations per save, 2000 nodes, and 240 KiB for the complete read response. Large replacement expansions and tables fail before allocation. The document must have persisted node IDs; if initialization is required, open it in Macro first. The entire batch is validated on an isolated document and committed against the revision you read. Conflicts apply nothing: open again and reconsider your changes. A handle can save once; after any failure, read again before retrying. Empty saves do nothing. Saves return { documentId, revision, applied }. Read again for the new state. Editing requires Edit access; opening only requires View. Oversized documents fail explicitly instead of returning a partial snapshot.`,
  ai: `Curated Vercel AI SDK calls, with credentials, admission and usage handled by the backend.
await sdk.ai.generateText({ prompt: string, system?: string, model?: 'fast' | 'good', maxOutputTokens?: number });
await sdk.ai.generateObject({ ...sameOptions, schema: JSONSchema });
Returns { text, object? (generateObject only), model (resolved model ID), finishReason, usage: { inputTokens, outputTokens } }.
Default model fast; default maxOutputTokens 1024, maximum 4096. The token budget includes model reasoning; a tiny budget can produce no text or incomplete output (finishReason: length). Prefer the default for structured output. Prompt and system together <= 64 KiB. Calls share the execution deadline; keep requests small and parallelize independent ones. No provider keys, URLs, arbitrary models, tools, or automatic retries. Structured output is validated; invalid output fails.
Schema must have an object root. Nested values support object, array, string, number, integer, boolean and null, properties, required, additionalProperties (boolean), items, enum, description, minLength, maxLength, minimum, maximum, minItems, maxItems. Enums support matching primitive values with no sibling constraints except type and description. No refs or external schemas. At most 8 levels, 200 schema nodes and 16 KiB. Stop ends code execution immediately; an AI call already dispatched may finish for usage accounting within its 28-second backend deadline (at most 16 per host), without continuing your code.
const r = await sdk.ai.generateObject({ prompt: 'Extract a title from: ' + text, schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } });
return r.object;`,
  templates: `sdk.templates.render(template: string, data: JSON, options?: { escape?: boolean }): string
Local Handlebars: {{value}}, {{#each rows}}{{name}}{{/each}}, if/unless/with, @index and built-in helpers. Missing fields fail (strict mode). HTML escaping defaults on; use { escape: false } for plain document text. Triple braces are normal Handlebars raw interpolation. No custom helpers, partial registration, prototype access or imports.
Limits: template 32 KiB, data 128 KiB, output 256 KiB; all rendering stays within sandbox memory and time limits.
return sdk.templates.render('{{#each names}}Hello {{this}}!\n{{/each}}', { names: ['Ada', 'Lin'] });`,
};
