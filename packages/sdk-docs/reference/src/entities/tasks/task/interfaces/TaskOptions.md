# Interface: TaskOptions

Task creation settings.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignees"></a> `assignees?` | [`User`](../../../users/user/classes/User.md)[] | Assignees; defaults to the creator. Pass `[]` to leave it unassigned. |
| <a id="property-duedate"></a> `dueDate?` | `Date` | - |
| <a id="property-initiative"></a> `initiative?` | [`Initiative`](../../../initiatives/initiative/classes/Initiative.md) | The initiative (shown as the task's Project in the app) it belongs to. |
| <a id="property-markdown"></a> `markdown?` | `string` | - |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-project"></a> `project?` | [`Project`](../../../projects/project/classes/Project.md) | Folder the task document is filed in; unrelated to [initiative](#property-initiative). |
| <a id="property-sharewithteam"></a> `shareWithTeam?` | `boolean` | Defaults to true. |
| <a id="property-team"></a> `team?` | [`Team`](../../../teams/team/classes/Team.md) | Scopes the team task number; may be omitted when the creator belongs to exactly one team. |
