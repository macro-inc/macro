import type { GithubPullRequestComment } from '@service-storage/generated/schemas';

const ICON =
  'https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/bot.svg';
const DARK_ICON =
  'https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/bot-dark.svg';
const AMBER =
  'https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/amber-16.svg';

/** A CodeRabbit review summary, in the shape the bot posts it. */
const REVIEW = `<!-- coderabbit-ai-generated:v1 -->

**Actionable comments posted: 1**

---

<!-- autofix_checkbox_start -->
- [ ] <!-- {"checkboxId":"0"} --> Fix comments: Fix CodeRabbit comments on this PR
<!-- autofix_checkbox_end -->

<details>
<summary><picture><source media="(prefers-color-scheme: dark)" srcset="${DARK_ICON}"><img src="${ICON}" width="16" height="16" align="absmiddle" alt=""></picture> Prompt to fix all issues</summary>
<dl>
<dd>

\`\`\`
Inline comments:
- Around line 12: Keep the cached rows visible when a refetch fails.
\`\`\`

</dd>
</dl>
</details>

<h6>
<details>
<summary><picture><img src="${ICON}" width="12" height="12" align="absmiddle" alt=""></picture> Review info</summary>
<dl>
<dd>
<br>

<details>
<summary><picture><img src="${ICON}" width="16" height="16" alt=""></picture> Run configuration</summary>
<dl>
<dd>
<br>

- **Repository**: [example/repo](<https://github.com/example/repo>)
- **Review profile**: CHILL

</dd>
</dl>
</details>

</dd>
</dl>
</details>
</h6>

<!-- This is an auto-generated comment by CodeRabbit -->`;

/** A CodeRabbit inline review comment. */
const INLINE = `<!-- coderabbit-ai-generated:v1 -->

**<picture><img src="${AMBER}" width="16" height="16" align="absmiddle" alt=""></picture> Minor** · **Functional Correctness** · **Quick win**

**Show a load failure instead of "No activity" when the read fails.**

When the first request fails, the list is empty and \`isPending\` is false, so the pane shows "No activity".

<details>
<summary>Suggested fix</summary>
<dl>
<dd>
<br>

\`\`\`diff
-  isPending: Accessor<boolean>;
+  isError: Accessor<boolean>;
\`\`\`

</dd>
</dl>
</details>

<!-- cr-comment:v1:0 -->`;

/** The walkthrough comment: a table and a risk summary with icons. */
const WALKTHROUGH = `<!-- walkthrough_start -->

<details>
<summary><strong>Merge Risk:</strong> <strong><picture><img src="${ICON}" width="16" height="16" align="absmiddle" alt=""></picture> Low</strong> · up to <code>b215c</code></summary>
<dl>
<dd>
<br>

The new panes are behind a feature flag.

</dd>
</dl>
</details>

<strong><sup><picture><img src="${ICON}" width="14" height="14" alt="Failed" title="Failed"></picture></sup> Failed checks: 1 warning</strong>

|  Check name | Status | Resolution |
| :--------- | :----: | :--------- |
| Title check | ![Warning](${ICON}) | Shorten the title. |

<!-- walkthrough_end -->`;

function comment(
  id: number,
  source: string,
  body: string,
  extra: Partial<GithubPullRequestComment> = {}
): GithubPullRequestComment {
  return {
    id,
    source,
    body,
    authorLogin: 'coderabbitai[bot]',
    createdAt: new Date(Date.UTC(2026, 10, 12, 12, id)).toISOString(),
    ...extra,
  };
}

export const CODERABBIT_COMMENTS: GithubPullRequestComment[] = [
  comment(1, 'issue_comment', WALKTHROUGH),
  comment(2, 'review', REVIEW),
  comment(3, 'review_comment', INLINE, {
    path: 'src/Activity.tsx',
    line: 222,
  }),
];
