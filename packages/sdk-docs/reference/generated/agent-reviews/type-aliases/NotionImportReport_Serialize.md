# Type Alias: NotionImportReport\_Serialize

> **NotionImportReport\_Serialize** = \{ `alreadyImportedBy`: [`NotionImporter`](NotionImporter.md)[]; `alreadyInMacro`: `number`; `copy`: `number`; `databaseRows`: `number`; `databases`: `number`; `dataSources`: `number`; `deciding`: `number`; `documents`: `number`; `error?`: `string` \| `null`; `failures`: [`NotionReportItem_Serialize`](NotionReportItem_Serialize.md)[]; `hand`: `number`; `handItems`: [`NotionReportItem_Serialize`](NotionReportItem_Serialize.md)[]; `imported`: `number`; `issues`: `number`; `onTeam`: `boolean`; `pages`: `number`; `projects`: `number`; `reviewId?`: `string` \| `null`; `scanned?`: [`ScanCounts`](ScanCounts.md) \| `null`; `sharedWithTeam`: `number`; `skip`: `number`; `status?`: [`RunStatus`](RunStatus.md) \| `null`; `taskRows`: `number`; `tasks`: `number`; `waiting`: `number`; `waitingOnTeammates`: `number`; `warnings?`: `string`[]; `writing`: `number`; \}

Where a Notion workspace import stands.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-alreadyimportedby"></a> `alreadyImportedBy` | [`NotionImporter`](NotionImporter.md)[] | Who imported the objects already in Macro, most first. |
| <a id="property-alreadyinmacro"></a> `alreadyInMacro` | `number` | Plan objects a teammate already imported and shared with the team; they link to that copy and are not counted as copies. |
| <a id="property-copy"></a> `copy` | `number` | Objects to copy as they are. |
| <a id="property-databaserows"></a> `databaseRows` | `number` | Rows those databases hold, every one counted while planning. |
| <a id="property-databases"></a> `databases` | `number` | Data sources written as databases. |
| <a id="property-datasources"></a> `dataSources` | `number` | Data sources (database tables) in the plan. |
| <a id="property-deciding"></a> `deciding` | `number` | Plan objects the decision model has not answered for yet, while planning is still `running`. |
| <a id="property-documents"></a> `documents` | `number` | Pages written as documents. |
| <a id="property-error"></a> `error?` | `string` \| `null` | Why the run failed, when it did. |
| <a id="property-failures"></a> `failures` | [`NotionReportItem_Serialize`](NotionReportItem_Serialize.md)[] | Objects that failed to import, with the failure. |
| <a id="property-hand"></a> `hand` | `number` | Objects that need handling by hand. |
| <a id="property-handitems"></a> `handItems` | [`NotionReportItem_Serialize`](NotionReportItem_Serialize.md)[] | Objects that need handling by hand, with reasons. |
| <a id="property-imported"></a> `imported` | `number` | Plan objects already imported. |
| <a id="property-issues"></a> `issues` | `number` | Tracker issues in the plan. |
| <a id="property-onteam"></a> `onTeam` | `boolean` | Whether the user is on a team. Without one, everything the import writes stays visible only to them. |
| <a id="property-pages"></a> `pages` | `number` | Pages in the plan. |
| <a id="property-projects"></a> `projects` | `number` | Tracker groups written as Macro projects. |
| <a id="property-reviewid"></a> `reviewId?` | `string` \| `null` | The review the plan is tied to, once presented. |
| <a id="property-scanned"></a> `scanned?` | [`ScanCounts`](ScanCounts.md) \| `null` | What planning has found in Notion so far, while it is `running`. |
| <a id="property-sharedwithteam"></a> `sharedWithTeam` | `number` | Written plan objects shared with the user's team. |
| <a id="property-skip"></a> `skip` | `number` | Objects left in Notion. |
| <a id="property-status"></a> `status?` | [`RunStatus`](RunStatus.md) \| `null` | The run's state: `running` while planning, `ready` once a plan is staged, `importing` while writing, `completed`, `failed`, or `dismissed` when cancelled. Absent before the first run. |
| <a id="property-taskrows"></a> `taskRows` | `number` | Tasks the task lists become, one per row. |
| <a id="property-tasks"></a> `tasks` | `number` | Data sources whose rows become tasks. |
| <a id="property-waiting"></a> `waiting` | `number` | Plan objects still waiting to be written. |
| <a id="property-waitingonteammates"></a> `waitingOnTeammates` | `number` | Plan objects waiting for a teammate who is writing the same object for the team; they link to the teammate's copy once it is written. |
| <a id="property-warnings"></a> `warnings?` | `string`[] | Provider items skipped because they were unreadable, or optional features unavailable. |
| <a id="property-writing"></a> `writing` | `number` | Plan objects being written now. |
