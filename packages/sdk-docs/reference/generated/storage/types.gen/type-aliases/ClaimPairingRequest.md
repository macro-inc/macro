# Type Alias: ClaimPairingRequest

> **ClaimPairingRequest** = \{ `device_secret`: `string`; \}

Request to claim an approved pairing's credential.

The daemon serializes this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-device_secret"></a> `device_secret` | `string` | The claim credential returned when the pairing was created. |
