# Type Alias: FormPublicationProblem

> **FormPublicationProblem** = \{ `kind`: `"invalidDraft"`; \} \| \{ `kind`: `"layout"`; `problem`: [`LayoutProblem`](LayoutProblem.md); \} \| \{ `kind`: `"widgetMismatch"`; `question`: `string`; \} \| \{ `kind`: `"fileUploadNeedsSignIn"`; \} \| \{ `kind`: `"pending"`; \}

An editor's saved draft is not yet the version respondents can use.

## Union Members

### Type Literal

\{ `kind`: `"invalidDraft"`; \}

***

### Type Literal

\{ `kind`: `"layout"`; `problem`: [`LayoutProblem`](LayoutProblem.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"layout"` | - |
| `problem` | [`LayoutProblem`](LayoutProblem.md) | The invariant the editor needs to repair. |

***

### Type Literal

\{ `kind`: `"widgetMismatch"`; `question`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"widgetMismatch"` | - |
| `question` | `string` | The question to repair. |

***

### Type Literal

\{ `kind`: `"fileUploadNeedsSignIn"`; \}

***

### Type Literal

\{ `kind`: `"pending"`; \}
