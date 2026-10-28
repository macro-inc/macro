# Type Alias: OpResultOf\<Kind, Change\>

> **OpResultOf**\<`Kind`, `Change`\> = `Extract`\<`ChangedResult`, \{ `kind`: `Kind`; \}\> & \{ `change`: `Extract`\<`Extract`\<`ChangedResult`, \{ `kind`: `Kind`; \}\>\[`"change"`\], \{ `kind`: `Change`; \}\>; \}

The result of a `Kind` op whose change answered `Change`.

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-kind"></a> `Kind` *extends* keyof `ResultChanges` |
| <a id="type-parameter-change"></a> `Change` *extends* `ResultChanges`\[`Kind`\] |

## Type Declaration

| Name | Type |
| ------ | ------ |
| `change` | `Extract`\<`Extract`\<`ChangedResult`, \{ `kind`: `Kind`; \}\>\[`"change"`\], \{ `kind`: `Change`; \}\> |
