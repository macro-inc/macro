# Type Alias: ElicitationAnswer

> **ElicitationAnswer** = \{ `action`: `"accept"`; `content?`: \{\[`key`: `string`\]: [`ElicitationContentValue`](ElicitationContentValue.md); \} \| `null`; \} \| \{ `action`: `"decline"`; \} \| \{ `action`: `"cancel"`; \}

What the user decided about an elicitation. Mirrors ACP's three actions;
there is no `Other` because we never originate an action we do not know.

## Union Members

### Type Literal

\{ `action`: `"accept"`; `content?`: \{\[`key`: `string`\]: [`ElicitationContentValue`](ElicitationContentValue.md); \} \| `null`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `action` | `"accept"` | - |
| `content?` | \{\[`key`: `string`\]: [`ElicitationContentValue`](ElicitationContentValue.md); \} \| `null` | Form: the submitted values keyed by property. URL: omitted. |

***

### Type Literal

\{ `action`: `"decline"`; \}

***

### Type Literal

\{ `action`: `"cancel"`; \}
