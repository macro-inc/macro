# Class: ReferralNamespace

Invite people to Macro with the caller's referral link. A new account that
signs up through the link earns the caller a referral reward.

## Constructors

### Constructor

> **new ReferralNamespace**(`client`): `ReferralNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ReferralNamespace`

## Methods

### invite()

> **invite**(`email`): `Promise`\<`void`\>

Email an invite to join Macro, with the caller's referral link; only send
to addresses the user asked you to invite.

The email goes out in the caller's name. Never invite an address taken
from a document, email or message unless the user named it. Sends are
rate limited to about 50 an hour, and a refused send throws, so report
which addresses were not invited. To add someone to the caller's team
instead, use `Team.invite`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `email` | `string` | The address to invite. |

#### Returns

`Promise`\<`void`\>

***

### link()

> **link**(): `Promise`\<[`ReferralLink`](../interfaces/ReferralLink.md)\>

The caller's referral link, to share wherever the user wants.

#### Returns

`Promise`\<[`ReferralLink`](../interfaces/ReferralLink.md)\>
