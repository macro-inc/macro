# Type Alias: OnboardingRow

> **OnboardingRow** = \{ `agent_client?`: `string` \| `null`; `agent_led_at?`: `string` \| `null`; `completed_at?`: `string` \| `null`; `skipped`: `boolean`; `started_at`: `string`; `status`: [`OnboardingStatus`](OnboardingStatus.md); \}

One user's onboarding row.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent_client"></a> `agent_client?` | `string` \| `null` | The MCP client that led setup (its registered name, e.g. `claude-code`), when known. |
| <a id="property-agent_led_at"></a> `agent_led_at?` | `string` \| `null` | When the person's own AI agent took over setup over MCP. `Some` means the account is agent-led: it skips the web flow, and its first web visit shows what the agent set up instead. |
| <a id="property-completed_at"></a> `completed_at?` | `string` \| `null` | When the flow completed, if it has. |
| <a id="property-skipped"></a> `skipped` | `boolean` | Whether the user skipped rather than finished. |
| <a id="property-started_at"></a> `started_at` | `string` | When the flow was first touched. |
| <a id="property-status"></a> `status` | [`OnboardingStatus`](OnboardingStatus.md) | Where the flow is in its lifecycle. |
