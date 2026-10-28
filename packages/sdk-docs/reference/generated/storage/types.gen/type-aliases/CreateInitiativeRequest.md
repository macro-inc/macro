# Type Alias: CreateInitiativeRequest

> **CreateInitiativeRequest** = \{ `description?`: `string` \| `null`; `memberIds?`: `string`[] \| `null`; `name`: `string`; `propertyValues?`: [`InitialPropertyValue`](InitialPropertyValue.md)[]; `shareWithTeam?`: `boolean` \| `null`; \}

Create-initiative HTTP body.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-description"></a> `description?` | `string` \| `null` | Initial markdown for the description surface. Not stored on the initiative; later edits happen in the collaborative description editor. |
| <a id="property-memberids"></a> `memberIds?` | `string`[] \| `null` | Optional member user ids. Invalid ids fail at the service boundary. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-propertyvalues"></a> `propertyValues?` | [`InitialPropertyValue`](InitialPropertyValue.md)[] | Property values set as the owner within the create. A value the properties service rejects fails the whole create; no initiative is left behind. |
| <a id="property-sharewithteam"></a> `shareWithTeam?` | `boolean` \| `null` | Share with the owner's team at create time. Defaults to true; users without a team create an unshared initiative. Explicit false skips the team grant. |
