# Type Alias: InputSuggestions

> **InputSuggestions** = \{ `intent`: `"ai"`; `suggestions`: [`AiSuggestions`](AiSuggestions.md); \} \| \{ `intent`: `"search"`; `suggestions`: [`SearchSuggestions`](SearchSuggestions.md); \} \| \{ `intent`: `"email"`; `suggestions`: [`EmailSuggestions`](EmailSuggestions.md); \} \| \{ `intent`: `"note"`; `suggestions`: [`NoteSuggestions`](NoteSuggestions.md); \} \| \{ `intent`: `"task"`; `suggestions`: [`TaskSuggestions`](TaskSuggestions.md); \} \| \{ `intent`: `"calendar"`; `suggestions`: [`CalendarSuggestions`](CalendarSuggestions.md); \} \| \{ `intent`: `"message"`; `suggestions`: [`MessageSuggestions`](MessageSuggestions.md); \}

A single inferred destination together with only its applicable fields.

## Union Members

### Type Literal

\{ `intent`: `"ai"`; `suggestions`: [`AiSuggestions`](AiSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"ai"` | - |
| `suggestions` | [`AiSuggestions`](AiSuggestions.md) | Editable ai fields. |

***

### Type Literal

\{ `intent`: `"search"`; `suggestions`: [`SearchSuggestions`](SearchSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"search"` | - |
| `suggestions` | [`SearchSuggestions`](SearchSuggestions.md) | Editable search fields. |

***

### Type Literal

\{ `intent`: `"email"`; `suggestions`: [`EmailSuggestions`](EmailSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"email"` | - |
| `suggestions` | [`EmailSuggestions`](EmailSuggestions.md) | Editable email fields. |

***

### Type Literal

\{ `intent`: `"note"`; `suggestions`: [`NoteSuggestions`](NoteSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"note"` | - |
| `suggestions` | [`NoteSuggestions`](NoteSuggestions.md) | Editable note fields. |

***

### Type Literal

\{ `intent`: `"task"`; `suggestions`: [`TaskSuggestions`](TaskSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"task"` | - |
| `suggestions` | [`TaskSuggestions`](TaskSuggestions.md) | Editable task fields. |

***

### Type Literal

\{ `intent`: `"calendar"`; `suggestions`: [`CalendarSuggestions`](CalendarSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"calendar"` | - |
| `suggestions` | [`CalendarSuggestions`](CalendarSuggestions.md) | Editable calendar fields. |

***

### Type Literal

\{ `intent`: `"message"`; `suggestions`: [`MessageSuggestions`](MessageSuggestions.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `intent` | `"message"` | - |
| `suggestions` | [`MessageSuggestions`](MessageSuggestions.md) | Editable message fields. |
