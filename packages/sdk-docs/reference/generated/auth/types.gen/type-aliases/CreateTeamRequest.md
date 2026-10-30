# Type Alias: CreateTeamRequest

> **CreateTeamRequest** = \{ `allow_domain_join?`: `boolean`; `name`: `string`; \}

The request body to create a new team

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_domain_join"></a> `allow_domain_join?` | `boolean` | Whether colleagues who sign up with the owner's work email domain join the team automatically. Ignored for generic email providers. |
| <a id="property-name"></a> `name` | `string` | The name of the team |
