# Type Alias: SourceIdentity

> **SourceIdentity** = \{ `kind`: `"known"`; `sourceId`: [`SourceId`](SourceId.md); \} \| \{ `kind`: `"confirmed_unknown"`; \}

Source identity supplied when creating a job. One binding per Macro team in v1.

## Union Members

### Type Literal

\{ `kind`: `"known"`; `sourceId`: [`SourceId`](SourceId.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"known"` | - |
| `sourceId` | [`SourceId`](SourceId.md) | Workspace identifier in the archive. |

***

### Type Literal

\{ `kind`: `"confirmed_unknown"`; \}
