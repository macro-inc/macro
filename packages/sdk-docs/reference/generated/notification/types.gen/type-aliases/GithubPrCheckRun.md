# Type Alias: GithubPrCheckRun

> **GithubPrCheckRun** = [`GithubPrNotificationCommon`](GithubPrNotificationCommon.md) & \{ `checkName`: `string`; `checkRunGithubId`: `number`; `checkStatus`: `string`; `checkUrl`: `string`; `completedAt`: `string`; `conclusion`: `string`; `state`: [`GithubPrCheckRunState`](GithubPrCheckRunState.md); \}

Metadata for a notification that a GitHub pull request check run completed.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `checkName` | `string` | The display name GitHub reported for the check run. |
| `checkRunGithubId` | `number` | The GitHub numeric id of the check run. |
| `checkStatus` | `string` | The raw GitHub check run status. |
| `checkUrl` | `string` | The public GitHub URL for the check run. |
| `completedAt` | `string` | When GitHub marked the check run as complete. |
| `conclusion` | `string` | The raw GitHub check run conclusion. |
| `state` | [`GithubPrCheckRunState`](GithubPrCheckRunState.md) | The normalized notification state for this check run. |
