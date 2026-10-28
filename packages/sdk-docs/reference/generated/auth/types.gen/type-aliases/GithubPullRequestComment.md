# Type Alias: GithubPullRequestComment

> **GithubPullRequestComment** = \{ `authorAssociation?`: `string` \| `null`; `authorId?`: `number` \| `null`; `authorLogin?`: `string` \| `null`; `body`: `string`; `createdAt?`: `string` \| `null`; `id`: `number`; `inReplyToId?`: `number` \| `null`; `line?`: `number` \| `null`; `originalLine?`: `number` \| `null`; `path?`: `string` \| `null`; `pullRequestReviewId?`: `number` \| `null`; `source`: `string`; `updatedAt?`: `string` \| `null`; `url?`: `string` \| `null`; \}

A comment associated with a GitHub pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authorassociation"></a> `authorAssociation?` | `string` \| `null` | GitHub's relationship label for the author, when available. |
| <a id="property-authorid"></a> `authorId?` | `number` \| `null` | The stable numeric GitHub user id for the comment author, when available. |
| <a id="property-authorlogin"></a> `authorLogin?` | `string` \| `null` | The GitHub login for the comment author, when available. |
| <a id="property-body"></a> `body` | `string` | The comment or review body text. |
| <a id="property-createdat"></a> `createdAt?` | `string` \| `null` | When the comment was created or the review was submitted. |
| <a id="property-id"></a> `id` | `number` | The unique GitHub identifier for the comment or review. |
| <a id="property-inreplytoid"></a> `inReplyToId?` | `number` \| `null` | The id of the comment this one replies to, when it is part of a review thread. Only ever present on `review_comment` sources. |
| <a id="property-line"></a> `line?` | `number` \| `null` | The line in the current diff the comment is anchored to. Cleared by GitHub when later commits outdate the comment's diff. |
| <a id="property-originalline"></a> `originalLine?` | `number` \| `null` | The line the comment was originally anchored to, kept even when the diff has since changed. |
| <a id="property-path"></a> `path?` | `string` \| `null` | The repository-relative file path the review comment is anchored to. Only ever present on `review_comment` sources. |
| <a id="property-pullrequestreviewid"></a> `pullRequestReviewId?` | `number` \| `null` | The id of the pull request review this comment was submitted with. Only ever present on `review_comment` sources. |
| <a id="property-source"></a> `source` | `string` | The GitHub source for the comment, such as `issue_comment` or `review_comment`. |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | When the comment or review was last updated. |
| <a id="property-url"></a> `url?` | `string` \| `null` | The public GitHub URL for the comment or review, when available. |
