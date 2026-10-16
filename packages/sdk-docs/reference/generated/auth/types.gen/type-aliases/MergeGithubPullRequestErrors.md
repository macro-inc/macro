# Type Alias: MergeGithubPullRequestErrors

> **MergeGithubPullRequestErrors** = \{ `401`: [`ErrorResponse`](ErrorResponse.md); `403`: [`ErrorResponse`](ErrorResponse.md); `404`: [`ErrorResponse`](ErrorResponse.md); `409`: [`ErrorResponse`](ErrorResponse.md); `422`: [`ErrorResponse`](ErrorResponse.md); `428`: [`ErrorResponse`](ErrorResponse.md); `500`: [`ErrorResponse`](ErrorResponse.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-403"></a> `403` | [`ErrorResponse`](ErrorResponse.md) | The user cannot push to the repository |
| <a id="property-404"></a> `404` | [`ErrorResponse`](ErrorResponse.md) | No GitHub link, or the pull request is not visible to the user |
| <a id="property-409"></a> `409` | [`ErrorResponse`](ErrorResponse.md) | The pull request is not mergeable as it stands, or its head moved |
| <a id="property-422"></a> `422` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-428"></a> `428` | [`ErrorResponse`](ErrorResponse.md) | - |
| <a id="property-500"></a> `500` | [`ErrorResponse`](ErrorResponse.md) | - |
