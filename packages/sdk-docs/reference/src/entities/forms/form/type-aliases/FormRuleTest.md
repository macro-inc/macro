# Type Alias: FormRuleTest

> **FormRuleTest** = `Exclude`\<[`FilterTest`](../../../../../generated/storage/types.gen/type-aliases/FilterTest.md), \{ `kind`: `"options"` \| `"entities"`; \}\> \| \{ `kind`: `"options"`; `operator`: `Extract`\<[`FilterTest`](../../../../../generated/storage/types.gen/type-aliases/FilterTest.md), \{ `kind`: `"options"`; \}\>\[`"operator"`\]; `options`: [`FormOption`](../../question/classes/FormOption.md)[]; \} \| \{ `entities`: [`FormEntityHandle`](../interfaces/FormEntityHandle.md)[]; `kind`: `"entities"`; `operator`: `Extract`\<[`FilterTest`](../../../../../generated/storage/types.gen/type-aliases/FilterTest.md), \{ `kind`: `"entities"`; \}\>\[`"operator"`\]; \}

A form rule, with option and entity references represented by handles.
