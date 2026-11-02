# Type Alias: GenerateImageReference

> **GenerateImageReference** = \{ `id`: `string`; `type`: `"document"`; \} \| \{ `id`: `string`; `type`: `"staticFile"`; \}

A reference image already stored in Macro.

## Union Members

### Type Literal

\{ `id`: `string`; `type`: `"document"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | The Macro document ID. |
| `type` | `"document"` | - |

***

### Type Literal

\{ `id`: `string`; `type`: `"staticFile"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | The static file ID. |
| `type` | `"staticFile"` | - |
