# The TypeScript module

For libraries and heavy computation (templates, parsing, formatting, data shaping), pass an optional TypeScript `module` beside the program in the same ExecuteCode call. The module runs in its own sandbox with no network and no Macro access, so it needs no permission; it lives only for that run. It is type-checked before anything runs, and may import Handlebars from `"handlebars"`.

The module exports values and functions with `export const` and `export function`. The program reads an export with `await get("name")` and calls an exported function, async or not, with `await call("name", ...args)`. Arguments and results are copied as JSON of at most about 255 KiB each, so pass the data the module needs, such as records the program fetched, and return plain data from it. An error the module throws, an unknown export or an oversized value rejects the promise with its message. The module's `console` output joins the logs, prefixed `module:`. Only the program reaches Macro: fetch in the program, compute in the module.

```js
// Read the document and let the module count its headings.
const doc = await tools.storage.get_document_markdown({ path: { document_id: "doc-1" } });
return await call("outline", doc.markdown);
```

with the module

```ts
export function outline(markdown: string): { headings: string[] } {
  return { headings: markdown.split("\n").filter((line) => line.startsWith("#")) };
}
```
