# Type Alias: PatchTeamMemberPlanData

> **PatchTeamMemberPlanData** = \{ `body`: [`PatchTeamMemberPlanRequest`](PatchTeamMemberPlanRequest.md); `path`: \{ `member_user_id`: `string`; \}; `query?`: `never`; `url`: `"/team/members/{member_user_id}/plan"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`PatchTeamMemberPlanRequest`](PatchTeamMemberPlanRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `member_user_id`: `string`; \} | - |
| `path.member_user_id` | `string` | The member whose seat plan changes |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/team/members/{member_user_id}/plan"` | - |
