# Type Alias: FormAnswerValue

> **FormAnswerValue** = `Exclude`\<[`CellValue`](../../../../../generated/storage/types.gen/type-aliases/CellValue.md), \{ `type`: `"rows"` \| `"options"` \| `"entities"`; \}\> \| \{ `type`: `"rows"`; `value`: [`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md)[]; \} \| \{ `type`: `"options"`; `value`: [`FormOption`](../../question/classes/FormOption.md)[]; \} \| \{ `type`: `"entities"`; `value`: \{ `entity`: [`FormEntityHandle`](../interfaces/FormEntityHandle.md); `entityType`: [`EntityKind`](../../../../../generated/storage/types.gen/type-aliases/EntityKind.md); \}[]; \}

An answer value; references use handles, and scalar values keep their cell representation.
