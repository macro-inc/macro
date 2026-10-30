# Type Alias: AutoArchiveOverrides

> **AutoArchiveOverrides** = \{ `onPullRequestMerged?`: `boolean`; `onRuntimeClosed?`: `boolean`; \}

One session's auto-archive choices. A trigger left `undefined` follows the
owner's default.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-onpullrequestmerged"></a> `onPullRequestMerged?` | `boolean` | Archive once every linked pull request is closed and at least one merged. |
| <a id="property-onruntimeclosed"></a> `onRuntimeClosed?` | `boolean` | Archive once the runtime session backing it is deliberately closed. |
