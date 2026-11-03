# Type Alias: MentionSpec

> **MentionSpec** = \{ `email`: `string`; `kind`: `"user"`; `userId`: `string`; \} \| \{ `contactId`: `string`; `emailOrDomain`: `string`; `isCompany`: `boolean`; `kind`: `"contact"`; `name`: `string`; \} \| \{ `groupAlias`: `string`; `kind`: `"group"`; \} \| \{ `blockName`: `string`; `blockParams?`: `Record`\<`string`, `string`\>; `documentId`: `string`; `documentName`: `string`; `kind`: `"document"`; \} \| \{ `expanded?`: `boolean`; `id`: `string`; `kind`: `"agent_session"`; `label?`: `string`; \} \| \{ `id`: `string`; `kind`: `"pr"`; `label?`: `string`; \} \| \{ `kind`: `"booking_link"`; `label?`: `string`; `profileId`: `string`; `slug?`: `string`; `url`: `string`; \} \| \{ `color?`: `string`; `kind`: `"tag"`; `name`: `string`; `optionId`: `string`; `propertyDefinitionId`: `string`; `scope`: `"user"` \| `"team"`; \}

Entity-mention specs. Ids are supplied with the edit request, not looked up.
 Date/time chips are `insertDate` / `{ inline: 'date' }`, not this union.
