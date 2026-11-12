# Type Alias: AppearanceIcon

> **AppearanceIcon** = \{ `kind`: `"macro"`; `name`: `string`; \} \| \{ `kind`: `"emoji"`; `value`: `string`; \}

The source of an entity's custom icon.

## Union Members

### Type Literal

\{ `kind`: `"macro"`; `name`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"macro"` | - |
| `name` | `string` | Catalog name without the SVG extension. |

***

### Type Literal

\{ `kind`: `"emoji"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"emoji"` | - |
| `value` | `string` | Unicode emoji text, not markup or a URL. |
