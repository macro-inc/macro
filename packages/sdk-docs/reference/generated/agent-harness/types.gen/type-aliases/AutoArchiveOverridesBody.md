# Type Alias: AutoArchiveOverridesBody

> **AutoArchiveOverridesBody** = \{ `onPullRequestMerged?`: `boolean` \| `null`; `onRuntimeClosed?`: `boolean` \| `null`; \}

One session's choices over its owner's defaults. `null` follows the owner.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-onpullrequestmerged"></a> `onPullRequestMerged?` | `boolean` \| `null` | Archive once the session's pull requests merge, or `null` to follow the owner. |
| <a id="property-onruntimeclosed"></a> `onRuntimeClosed?` | `boolean` \| `null` | Archive once the session's runtime session is deliberately closed, or `null` to follow the owner. |
