# Type Alias: WorkspaceFilters

> **WorkspaceFilters** = `Pick`\<[`ApiEntityFilterAst`](../../../../../generated/storage/types.gen/type-aliases/ApiEntityFilterAst.md), `"df"` \| `"pf"` \| `"cf"` \| `"ef"` \| `"chanf"` \| `"cthf"` \| `"callf"` \| `"fef"` \| `"calf"` \| `"propf"`\>

Server-validated AST filters, identical to the normal workspace API. Use
`{l: literal}`, `{'&': [left, right]}`, `{'|': [left, right]}` or `{'!': expr}`.
`&` and `|` require exactly two expressions; nest them for three or more.
A single condition is `{l: literal}` without an `&` wrapper.
Each entity filter applies only to that type; `propf` applies across types.
See WorkspaceNamespace for task and time-window examples.
