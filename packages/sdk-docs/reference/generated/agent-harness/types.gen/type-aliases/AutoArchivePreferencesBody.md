# Type Alias: AutoArchivePreferencesBody

> **AutoArchivePreferencesBody** = \{ `onPullRequestMerged`: `boolean`; `onRuntimeClosed`: `boolean`; \}

Which triggers archive the caller's sessions when a session has no choice of its own.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-onpullrequestmerged"></a> `onPullRequestMerged` | `boolean` | Archive a session once every pull request linked to it is closed and at least one merged. |
| <a id="property-onruntimeclosed"></a> `onRuntimeClosed` | `boolean` | Archive a session once the runtime session backing it is deliberately closed. |
