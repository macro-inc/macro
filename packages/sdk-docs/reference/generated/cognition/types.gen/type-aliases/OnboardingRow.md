# Type Alias: OnboardingRow

> **OnboardingRow** = \{ `completed_at?`: `string` \| `null`; `skipped`: `boolean`; `started_at`: `string`; `status`: [`OnboardingStatus`](OnboardingStatus.md); \}

One user's onboarding row.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-completed_at"></a> `completed_at?` | `string` \| `null` | When the flow completed, if it has. |
| <a id="property-skipped"></a> `skipped` | `boolean` | Whether the user skipped rather than finished. |
| <a id="property-started_at"></a> `started_at` | `string` | When the flow was first touched. |
| <a id="property-status"></a> `status` | [`OnboardingStatus`](OnboardingStatus.md) | Where the flow is in its lifecycle. |
