# Type Alias: CodeUpgrade

> **CodeUpgrade** = \{ `createdAt`: `string`; `fromSdk?`: `string` \| `null`; `id`: `string`; `outcome`: [`UpgradeOutcome`](UpgradeOutcome.md); `previousTask`: \{\[`key`: `string`\]: `unknown`; \}; `reason?`: `string` \| `null`; `task?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; `toSdk`: `string`; `updatedAt`: `string`; \}

One time a routine's code was brought to a new SDK.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | - |
| <a id="property-fromsdk"></a> `fromSdk?` | `string` \| `null` | The SDK the code was checked against before; none when it never was. |
| <a id="property-id"></a> `id` | `string` | - |
| <a id="property-outcome"></a> `outcome` | [`UpgradeOutcome`](UpgradeOutcome.md) | - |
| <a id="property-previoustask"></a> `previousTask` | \{\[`key`: `string`\]: `unknown`; \} | The task before. |
| <a id="property-reason"></a> `reason?` | `string` \| `null` | Why the routine needs its owner. |
| <a id="property-task"></a> `task?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | The saved rewrite, or the rewrite that failed its checks. |
| <a id="property-tosdk"></a> `toSdk` | `string` | The SDK it was brought to. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | - |
