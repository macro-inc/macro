# Type Alias: CodexLoginStart

> **CodexLoginStart** = \{ `attemptId`: `string`; `expiresAt`: `string`; `pollIntervalSeconds`: `number`; `userCode`: `string`; `verificationUrl`: `string`; \}

Expiring browser authorization instructions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attemptid"></a> `attemptId` | `string` | Owner-bound attempt UUID. |
| <a id="property-expiresat"></a> `expiresAt` | `string` | UTC attempt deadline. |
| <a id="property-pollintervalseconds"></a> `pollIntervalSeconds` | `number` | Minimum browser polling interval. |
| <a id="property-usercode"></a> `userCode` | `string` | Short expiring user code, not an API credential. |
| <a id="property-verificationurl"></a> `verificationUrl` | `string` | Official provider verification URL. |
