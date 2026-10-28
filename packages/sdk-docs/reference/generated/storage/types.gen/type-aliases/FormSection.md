# Type Alias: FormSection

> **FormSection** = \{ `description`: `string`; `id`: `string`; `kind`: `"questions"`; `questions`: [`QuestionLayout`](QuestionLayout.md)[]; `title`: `string`; \} \| \{ `description`: `string`; `id`: `string`; `kind`: `"gate"`; `message`: `string`; `rules`: [`FilterGroup`](FilterGroup.md); `title`: `string`; \} \| \{ `description`: `string`; `id`: `string`; `kind`: `"booking"`; `target`: [`BookingTarget`](BookingTarget.md); `title`: `string`; \}

One section of a layout: questions on one screen, or a gate the answers
so far must pass.

## Union Members

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"questions"`; `questions`: [`QuestionLayout`](QuestionLayout.md)[]; `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | What respondents read under the title. |
| `id` | `string` | The section, under an id the client mints. |
| `kind` | `"questions"` | - |
| `questions` | [`QuestionLayout`](QuestionLayout.md)[] | Its questions, in order. |
| `title` | `string` | Its title; may be empty. |

***

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"gate"`; `message`: `string`; `rules`: [`FilterGroup`](FilterGroup.md); `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | Its description, for editors. |
| `id` | `string` | The section, under an id the client mints. |
| `kind` | `"gate"` | - |
| `message` | `string` | What a stopped respondent reads. |
| `rules` | [`FilterGroup`](FilterGroup.md) | The rules, naming only columns asked in earlier sections. |
| `title` | `string` | Its title, for editors. |

***

### Type Literal

\{ `description`: `string`; `id`: `string`; `kind`: `"booking"`; `target`: [`BookingTarget`](BookingTarget.md); `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `description` | `string` | What respondents read before choosing a time. |
| `id` | `string` | The section, under an id the client mints. |
| `kind` | `"booking"` | - |
| `target` | [`BookingTarget`](BookingTarget.md) | The native booking event. Respondent layouts never include this target. |
| `title` | `string` | Its title. |
