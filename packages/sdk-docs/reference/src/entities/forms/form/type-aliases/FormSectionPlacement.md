# Type Alias: FormSectionPlacement

> **FormSectionPlacement** = \{ `description?`: `string`; `section?`: [`FormSection`](../../section/classes/FormSection.md); `title`: `string`; \} & \{ `kind`: `"questions"`; `questions`: [`FormQuestionPlacement`](FormQuestionPlacement.md)[]; \} \| \{ `kind`: `"gate"`; `message`: `string`; `rules`: [`FormRules`](FormRules.md); \} \| \{ `kind`: `"booking"`; `target`: [`BookingTarget`](../../../../../generated/storage/types.gen/type-aliases/BookingTarget.md); \}

A section in a layout replacement. Omit section to mint a new stable section.

## Type Declaration

| Name | Type |
| ------ | ------ |
| `description?` | `string` |
| `section?` | [`FormSection`](../../section/classes/FormSection.md) |
| `title` | `string` |
