# The TypeScript module

For libraries and heavy computation (templates, parsing, formatting, data shaping), pass an optional TypeScript `module` beside the program in the same ExecuteCode call. The module has no network and no Macro access, so it needs no permission; it lives only for that run.

The module exports values and functions with `export const` and `export function`. The program reads an export with `await get("name")` and calls one with `await call("name", ...args)`. Arguments and results are copied as plain data (JSON-like values), so pass the data the module needs, such as records the program fetched, and return plain data from it. Only the program reaches Macro: fetch in the program, compute in the module.
