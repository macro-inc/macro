# Type Alias: CreatedPairing

> **CreatedPairing** = \{ `code`: `string`; `device_secret`: `string`; `expires_at`: `string`; `pairing_id`: `string`; `poll_interval_seconds`: `number`; \}

A pairing the daemon created, including its claim credential.

`device_secret` is returned exactly once and never stored raw; the daemon
keeps it to claim the harness credential after approval.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Human-readable code the user confirms in the web app, `XXXX-XXXX`. |
| <a id="property-device_secret"></a> `device_secret` | `string` | Claim credential the daemon must present. Shown only here. |
| <a id="property-expires_at"></a> `expires_at` | `string` | When the pairing expires. |
| <a id="property-pairing_id"></a> `pairing_id` | `string` | Pairing id used to poll for the claim. |
| <a id="property-poll_interval_seconds"></a> `poll_interval_seconds` | `number` | Suggested delay between claim polls. |
