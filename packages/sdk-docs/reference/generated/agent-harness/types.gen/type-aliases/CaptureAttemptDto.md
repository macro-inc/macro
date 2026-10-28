# Type Alias: CaptureAttemptDto

> **CaptureAttemptDto** = \{ `error?`: `string` \| `null`; `finishedAt?`: `string` \| `null`; `outcome?`: `null` \| [`CaptureOutcomeDto`](CaptureOutcomeDto.md); `startedAt`: `string`; \}

The latest capture attempt.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `string` \| `null` | Why it did not capture, in a sentence the user can read. |
| <a id="property-finishedat"></a> `finishedAt?` | `string` \| `null` | When it ended; absent while it runs. |
| <a id="property-outcome"></a> `outcome?` | `null` \| [`CaptureOutcomeDto`](CaptureOutcomeDto.md) | - |
| <a id="property-startedat"></a> `startedAt` | `string` | When it started. |
