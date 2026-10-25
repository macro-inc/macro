# Type Alias: NotionImportReport

> **NotionImportReport** = \{ `alreadyImportedBy?`: [`NotionImporter`](NotionImporter.md)[]; `alreadyInMacro?`: `number`; `copy`: `number`; `databaseRows`: `number`; `databases`: `number`; `dataSources`: `number`; `deciding?`: `number`; `documents`: `number`; `error?`: `string` \| `null`; `failures?`: [`NotionReportItem`](NotionReportItem.md)[]; `hand`: `number`; `handItems?`: [`NotionReportItem`](NotionReportItem.md)[]; `imported`: `number`; `onTeam?`: `boolean`; `pages`: `number`; `reviewId?`: `string` \| `null`; `scanned?`: `null` \| [`ScanCounts`](ScanCounts.md); `sharedWithTeam?`: `number`; `skip`: `number`; `status?`: `null` \| [`RunStatus`](RunStatus.md); `taskRows`: `number`; `tasks`: `number`; `waiting`: `number`; `waitingOnTeammates?`: `number`; `writing`: `number`; \}

Where a Notion workspace import stands.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-alreadyimportedby"></a> `alreadyImportedBy?` | [`NotionImporter`](NotionImporter.md)[] | Who imported the objects already in Macro, most first. |
| <a id="property-alreadyinmacro"></a> `alreadyInMacro?` | `number` | Plan objects a teammate already imported and shared with the team; they link to that copy and are not counted as copies. |
| <a id="property-copy"></a> `copy` | `number` | Objects to copy as they are. |
| <a id="property-databaserows"></a> `databaseRows` | `number` | Rows those databases hold, every one counted while planning. |
| <a id="property-databases"></a> `databases` | `number` | Data sources written as databases. |
| <a id="property-datasources"></a> `dataSources` | `number` | Data sources (database tables) in the plan. |
| <a id="property-deciding"></a> `deciding?` | `number` | Plan objects the decision model has not answered for yet, while planning is still `running`. |
| <a id="property-documents"></a> `documents` | `number` | Pages written as documents. |
| <a id="property-error"></a> `error?` | `string` \| `null` | Why the run failed, when it did. |
| <a id="property-failures"></a> `failures?` | [`NotionReportItem`](NotionReportItem.md)[] | Objects that failed to import, with the failure. |
| <a id="property-hand"></a> `hand` | `number` | Objects that need handling by hand. |
| <a id="property-handitems"></a> `handItems?` | [`NotionReportItem`](NotionReportItem.md)[] | Objects that need handling by hand, with reasons. |
| <a id="property-imported"></a> `imported` | `number` | Plan objects already imported. |
| <a id="property-onteam"></a> `onTeam?` | `boolean` | Whether the user is on a team. Without one, everything the import writes stays visible only to them. |
| <a id="property-pages"></a> `pages` | `number` | Pages in the plan. |
| <a id="property-reviewid"></a> `reviewId?` | `string` \| `null` | The review the plan is tied to, once presented. |
| <a id="property-scanned"></a> `scanned?` | `null` \| [`ScanCounts`](ScanCounts.md) | - |
| <a id="property-sharedwithteam"></a> `sharedWithTeam?` | `number` | Written plan objects shared with the user's team. |
| <a id="property-skip"></a> `skip` | `number` | Objects left in Notion. |
| <a id="property-status"></a> `status?` | `null` \| [`RunStatus`](RunStatus.md) | - |
| <a id="property-taskrows"></a> `taskRows` | `number` | Tasks the task lists become, one per row. |
| <a id="property-tasks"></a> `tasks` | `number` | Data sources whose rows become tasks. |
| <a id="property-waiting"></a> `waiting` | `number` | Plan objects still waiting to be written. |
| <a id="property-waitingonteammates"></a> `waitingOnTeammates?` | `number` | Plan objects waiting for a teammate who is writing the same object for the team; they link to the teammate's copy once it is written. |
| <a id="property-writing"></a> `writing` | `number` | Plan objects being written now. |
