# Type Alias: MeetingNote

> **MeetingNote** = \{ `canManage`: `boolean`; `documentId`: `string`; `name`: `string`; `team?`: `null` \| [`NoteTeam`](NoteTeam.md); \}

One linked document and the extra access this link grants.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-canmanage"></a> `canManage` | `boolean` | Whether this viewer can change this document's sharing. |
| <a id="property-documentid"></a> `documentId` | `string` | Markdown document identity. |
| <a id="property-name"></a> `name` | `string` | Current document name. |
| <a id="property-team"></a> `team?` | `null` \| [`NoteTeam`](NoteTeam.md) | - |
