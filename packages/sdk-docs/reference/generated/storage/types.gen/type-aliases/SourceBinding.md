# Type Alias: SourceBinding

> **SourceBinding** = \{ `kind`: `"unbound"`; \} \| \{ `kind`: `"confirmed_unknown"`; \} \| \{ `kind`: `"known"`; `sourceId`: [`SourceId`](SourceId.md); \}

Team's durable single-source binding, including confirmed unidentified archives.

## Union Members

### Type Literal

\{ `kind`: `"unbound"`; \}

***

### Type Literal

\{ `kind`: `"confirmed_unknown"`; \}

***

### Type Literal

\{ `kind`: `"known"`; `sourceId`: [`SourceId`](SourceId.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"known"` | - |
| `sourceId` | [`SourceId`](SourceId.md) | Bound source identity. |
