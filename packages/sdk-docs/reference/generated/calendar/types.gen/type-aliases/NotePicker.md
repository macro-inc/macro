# Type Alias: NotePicker

> **NotePicker** = \{ `documents`: [`NoteDocument`](NoteDocument.md)[]; `teams`: [`NoteTeam`](NoteTeam.md)[]; \}

Picker results; only documents whose owner is the caller are suggested.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documents"></a> `documents` | [`NoteDocument`](NoteDocument.md)[] | At most 30 matching markdown documents, most recently updated first. |
| <a id="property-teams"></a> `teams` | [`NoteTeam`](NoteTeam.md)[] | Teams the caller currently belongs to. |
