# Type Alias: GetLegacyUserPermissionsResponse

> **GetLegacyUserPermissionsResponse** = \{ `aiDataConsent`: `boolean`; `createdAt?`: `string` \| `null`; `email`: `string`; `group?`: `null` \| [`AbGroup`](AbGroup.md); `hasChromeExt`: `boolean`; `hasTrialed`: `boolean`; `licenseStatus`: `string`; `name?`: `string` \| `null`; `permissions`: `string`[]; `referralCode`: `string`; `tutorialComplete`: `boolean`; `userId`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-aidataconsent"></a> `aiDataConsent` | `boolean` | Whether the user has consented to AI data sharing |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | When the account was created. Absent for accounts that predate creation-time tracking. |
| <a id="property-email"></a> `email` | `string` | The user's email |
| <a id="property-group"></a> `group?` | `null` \| [`AbGroup`](AbGroup.md) | - |
| <a id="property-haschromeext"></a> `hasChromeExt` | `boolean` | Whether the user has the chrome extension |
| <a id="property-hastrialed"></a> `hasTrialed` | `boolean` | Whether the user has trialed through stripe |
| <a id="property-licensestatus"></a> `licenseStatus` | `string` | The user's license status |
| <a id="property-name"></a> `name?` | `string` \| `null` | The user's name |
| <a id="property-permissions"></a> `permissions` | `string`[] | The permissions the user has |
| <a id="property-referralcode"></a> `referralCode` | `string` | The referral code for the user |
| <a id="property-tutorialcomplete"></a> `tutorialComplete` | `boolean` | Whether the user has completed the tutorial |
| <a id="property-userid"></a> `userId` | `string` | The user id |
