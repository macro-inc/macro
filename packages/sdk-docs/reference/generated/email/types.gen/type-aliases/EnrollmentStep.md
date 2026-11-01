# Type Alias: EnrollmentStep

> **EnrollmentStep** = [`Step`](Step.md) & \{ `scheduledAt?`: `string` \| `null`; `sentAt?`: `string` \| `null`; `status`: [`StepStatus`](StepStatus.md); \}

One rendered step of an enrollment with what happened to it.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `scheduledAt?` | `string` \| `null` | When it was scheduled to send. |
| `sentAt?` | `string` \| `null` | When it was sent. |
| `status` | [`StepStatus`](StepStatus.md) | What happened to its email. |
