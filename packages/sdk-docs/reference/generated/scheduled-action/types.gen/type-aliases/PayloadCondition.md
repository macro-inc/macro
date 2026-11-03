# Type Alias: PayloadCondition

> **PayloadCondition** = \{ `equals?`: `null` \| [`PayloadScalar`](PayloadScalar.md); `exists?`: `boolean` \| `null`; `glob?`: `string` \| `null`; `in?`: [`PayloadScalar`](PayloadScalar.md)[] \| `null`; `notIn?`: [`PayloadScalar`](PayloadScalar.md)[] \| `null`; `path`: `string`[]; \}

`path` walks objects by key; `*` steps into every element of an array and
a number into one. Give exactly one test. `notIn` also passes when the
path finds nothing.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-equals"></a> `equals?` | `null` \| [`PayloadScalar`](PayloadScalar.md) | - |
| <a id="property-exists"></a> `exists?` | `boolean` \| `null` | Whether the path finds a non-null value. |
| <a id="property-glob"></a> `glob?` | `string` \| `null` | Some text found matches this glob; `*` matches any run of characters. |
| <a id="property-in"></a> `in?` | [`PayloadScalar`](PayloadScalar.md)[] \| `null` | Some value found is one of these. |
| <a id="property-notin"></a> `notIn?` | [`PayloadScalar`](PayloadScalar.md)[] \| `null` | No value found is one of these. |
| <a id="property-path"></a> `path` | `string`[] | Keys from the payload's root, e.g. `["workflow_run", "conclusion"]`. |
