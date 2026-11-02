# Class: CrmNamespace

## Constructors

### Constructor

> **new CrmNamespace**(`client`): `CrmNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`CrmNamespace`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-pipelines"></a> `pipelines` | `readonly` | [`PipelineNamespace`](../../pipelines/classes/PipelineNamespace.md) | Pipelines, their records and sharing settings. |

## Methods

### blockDomain()

> **blockDomain**(`domain`): `Promise`\<`void`\>

Block a domain (like `acme.com`): email sync skips it, and the company
and contacts already in the CRM for it are hidden. Requires a team admin.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `domain` | `string` |

#### Returns

`Promise`\<`void`\>

***

### blockedDomains()

> **blockedDomains**(): `Promise`\<`string`[]\>

The domains the caller's current team keeps out of email sync.

#### Returns

`Promise`\<`string`[]\>

***

### companyById()

> **companyById**(`id`): [`Company`](../../company/classes/Company.md)

A handle to a CRM company by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Company`](../../company/classes/Company.md)

***

### contactByEmail()

> **contactByEmail**(`email`): `Promise`\<[`Contact`](../../contact/classes/Contact.md) \| `undefined`\>

Resolve a CRM contact by email in the caller's current team, if present.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `email` | `string` |

#### Returns

`Promise`\<[`Contact`](../../contact/classes/Contact.md) \| `undefined`\>

***

### contactById()

> **contactById**(`id`): [`Contact`](../../contact/classes/Contact.md)

A handle to a CRM contact by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Contact`](../../contact/classes/Contact.md)

***

### createCompany()

> **createCompany**(`opts`): `Promise`\<[`Company`](../../company/classes/Company.md)\>

Create a CRM company for the caller's current team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`CreateCrmCompanyRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateCrmCompanyRequest.md) |

#### Returns

`Promise`\<[`Company`](../../company/classes/Company.md)\>

***

### createContact()

> **createContact**(`opts`): `Promise`\<[`Contact`](../../contact/classes/Contact.md)\>

Create a contact without a company for the caller's current team. The
email is optional and may be at any domain. To add someone to a company,
use [Company.createContact](../../company/classes/Company.md#createcontact).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`CreateCrmTeamContactRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateCrmTeamContactRequest.md) |

#### Returns

`Promise`\<[`Contact`](../../contact/classes/Contact.md)\>

***

### resetStages()

> **resetStages**(): `Promise`\<`void`\>

Reset the caller's current team's deal stages to the defaults.

#### Returns

`Promise`\<`void`\>

***

### searchCompanies()

> **searchCompanies**(`query`): `AsyncGenerator`\<[`Company`](../../company/classes/Company.md)\>

Search CRM companies by name/domain, most relevant first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |

#### Returns

`AsyncGenerator`\<[`Company`](../../company/classes/Company.md)\>

***

### searchContacts()

> **searchContacts**(`query`, `opts?`): `Promise`\<[`Contact`](../../contact/classes/Contact.md)[]\>

Search the caller's current team's CRM contacts whose email or name
contains `query` (case-insensitive), most recently interacted first.
An empty query lists the most recent contacts.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `query` | `string` | - |
| `opts?` | \{ `limit?`: `number`; \} | - |
| `opts.limit?` | `number` | Maximum contacts to return (1-500, default 20). |

#### Returns

`Promise`\<[`Contact`](../../contact/classes/Contact.md)[]\>

***

### setStages()

> **setStages**(`stages`): `Promise`\<[`CrmStagesResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmStagesResponse.md)\>

Replace the caller's current team's deal stages, in pipeline order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `stages` | [`ReplaceCrmStagesRequest`](../../../../../generated/storage/types.gen/type-aliases/ReplaceCrmStagesRequest.md) |

#### Returns

`Promise`\<[`CrmStagesResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmStagesResponse.md)\>

***

### settings()

> **settings**(): `Promise`\<[`CrmTeamSettingsResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmTeamSettingsResponse.md)\>

The caller's current team's CRM settings.

#### Returns

`Promise`\<[`CrmTeamSettingsResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmTeamSettingsResponse.md)\>

***

### unblockDomain()

> **unblockDomain**(`domain`): `Promise`\<`void`\>

Unblock a domain: email sync resumes and what blocking hid is shown
again. Requires a team admin.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `domain` | `string` |

#### Returns

`Promise`\<`void`\>

***

### updateSettings()

> **updateSettings**(`settings`): `Promise`\<[`CrmTeamSettingsResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmTeamSettingsResponse.md)\>

Partially update the caller's current team's CRM settings.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `settings` | [`UpdateCrmTeamSettingsRequest`](../../../../../generated/storage/types.gen/type-aliases/UpdateCrmTeamSettingsRequest.md) |

#### Returns

`Promise`\<[`CrmTeamSettingsResponse`](../../../../../generated/storage/types.gen/type-aliases/CrmTeamSettingsResponse.md)\>
