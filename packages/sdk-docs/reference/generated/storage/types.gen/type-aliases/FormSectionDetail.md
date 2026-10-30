# Type Alias: FormSectionDetail

> **FormSectionDetail** = \{ `description`: `string`; `id`: `string`; `kind`: `"questions"`; `questions`: [`FormQuestionDetail`](FormQuestionDetail.md)[]; `title`: `string`; \} \| \{ `description`: `string`; `id`: `string`; `kind`: `"gate"`; `message`: `string`; `rules`: [`FilterGroup`](FilterGroup.md); `title`: `string`; \} \| \{ `description`: `string`; `id`: `string`; `kind`: `"booking"`; `target?`: [`BookingTarget`](BookingTarget.md); `title`: `string`; \}

One section of a form as it reads.

## Union Members

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"questions"`; `questions`: [`FormQuestionDetail`](FormQuestionDetail.md)[]; `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | Its description. |
| `id` | `string` | The section. |
| `kind` | `"questions"` | - |
| `questions` | [`FormQuestionDetail`](FormQuestionDetail.md)[] | Its questions, in order. |
| `title` | `string` | Its title. |

***

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"gate"`; `message`: `string`; `rules`: [`FilterGroup`](FilterGroup.md); `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | Its description. |
| `id` | `string` | The section. |
| `kind` | `"gate"` | - |
| `message` | `string` | What a stopped respondent reads. |
| `rules` | [`FilterGroup`](FilterGroup.md) | The rules. |
| `title` | `string` | Its title. |

***

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"booking"`; `target?`: [`BookingTarget`](BookingTarget.md); `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | Its description. |
| `id` | `string` | The section. |
| `kind` | `"booking"` | - |
| `target?` | [`BookingTarget`](BookingTarget.md) | Editors can configure the destination; respondent layouts omit it. |
| `title` | `string` | Its title. |
