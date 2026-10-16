# Pull requests

## Pull requests — `/app/reviews/pr/<foreignEntityId>`

Opening **Reviews** from the mobile dock's **More** drawer starts on **Pull
requests** (the **All** scope). Explicit review-tab links keep their selected
scope; desktop's default scope remains **Involves me**.

Macro-linked GitHub pull requests open inside the Reviews shell, with a Reviews
breadcrumb, PR title/status, linked GitHub metadata, discussion timeline, and Details/Checks
side panel below the top bar. An open PR that is not a draft, and whose checks
have all finished with a success, skipped, or neutral conclusion, also shows a
**Merge** button in the top bar beside **Changes**. It opens a confirmation with the repository, PR number,
and title, then merges on GitHub as the signed-in user through their linked account.
GitHub's permissions and branch protections decide; a refusal appears as a toast
with GitHub's reason, and a merge refreshes the PR status in place. Without a linked
GitHub account the toast points to Settings. Draft PRs, PRs with no checks, and PRs
whose checks are still running or failing have no Merge button. Merged and closed
PRs have no Merge button. PRs are not tasks and do not appear in the Tasks list.
The metadata pills beneath the PR title include linked agent sessions, using the
agent sparkle icon. A single session shows its name; several sessions show a
count chip opening a session list. Selecting a session opens it, with Shift-click
on the single-session chip opening another split. The same chip appears in PR
list metadata without activating its containing PR row. Empty links show no chip;
loading or inaccessible session previews are not navigable. PR status pills stay
passive; status filtering uses the Reviews list's Open/Closed sliding tabs and
filter menu.
Opening **Changes** slides a full-height pane in from the right beside the PR details,
including beside the PR top bar rather than underneath it. The PR details shrink
alongside the entry slide instead of eagerly jumping narrower. The Changes pane
has no outer top, right, or bottom border. The PR's `+N −M` diff count pill also
opens the pane when changes are available; it remains a passive count without a
Changes controller or when changes are unavailable.
Closing slides the pane fully off the right edge while expanding the left pane,
without fading in either direction or a final width snap. From full width, the PR
details appear behind the sliding pane, without blank space. Reopening during exit
keeps the same pane mounted.
The pane shell opens before the diff bodies render. Reduced-motion preferences
disable both animations.
The PR breadcrumb and side-panel toggle remain above the left pane. The
**Changes** toggle stays visible in split view, ghost while closed and accent text
on a tinted background while open; clicking it again closes the pane. There is no standalone **Open on
GitHub** button: the pane header has no visible Changes title, and its
`head → base · #N` is one plain-text GitHub link, underlined on hover without a
pill background or icon. GitHub diff totals and five green/red squares appear
beside the PR number in both split and full-width layouts. The squares summarize
the addition/deletion mix; the numbers retain exact totals. At full width, a smaller
PR title appears before the link. Both title and totals come from the existing PR
query; unavailable values stay hidden, without placeholders or captured-count
fallbacks. File headers highlight on hover. When space is tight, the smaller
branch/PR/count metadata wraps below the title, while pane actions stay separate.
The Changes toggle has no diff totals and becomes icon-only below 28rem of header
width, retaining its name, tooltip, and active state. Breadcrumbs keep their existing layout.
The full-height file tree has a fixed header with its file count on the left and
**Hide file tree** on the right. Borderless diff controls float above the diff stack
rather than spanning the pane in a second toolbar. Unified/Split retains text labels
at narrow non-touch widths on the left, with diff collapse/expand and refresh on
the right. Hiding the tree moves its count
and **Show file tree** above the diffs, as described in
[AI Chat](ai-chat.md#reviewing-a-linked-github-pull-request).
Spotlighting changes hides the left pane and its top bar; **Back to the split**
restores the prior divider position and retains the draft, diff state, and scroll.
At host widths of 720px or less, Changes opens full-width automatically without
that width toggle; widening restores the requested wide layout and split ratio.
Narrow file trees start closed. **Show file tree** opens an animated drawer over the
diffs without resizing them, including on phones. File selection, Escape, the
backdrop, or **Hide file tree** closes the drawer and restores focus to its opener.
The drawer does not change the saved wide-tree visibility or preferred width.
Closing releases the drawer's dialog handlers immediately while its inert visual
frame finishes exiting, so rapid reopening does not restore focus to a stale opener.
The file tree has its own draggable, keyboard-resizable divider and remembers its
width locally. Tree visibility uses the sidebar's shared width transition while
retaining directory state and diff owners. Reduced motion skips this transition.
The divider remains visible but inert through the tree's exit. Resizing the outer
split or viewport settles active tree motion before applying the new geometry.
**Copy path** briefly shows a non-pulsing success checkmark without collapsing
the file. The PR viewer stays read-only and does not offer agent review notes.
Copy Link from a PR in Quick Access copies `/app/reviews/pr/<foreignEntityId>`.
Old `/app/pr/<foreignEntityId>` links redirect to Reviews. Check a copied link,
a PR opened from a list or agent session, a second split, breadcrumb return,
side-panel toggle, and phone layout. If no GitHub data loads, the detail shows
an error banner with a Retry button; pressing it refetches the PR in place.

PR metadata changes should update an already loaded Reviews list row and the
linked agent session's PR status without reloading the page. To verify, keep
both rows visible and change the PR in GitHub; check the status after the
webhook arrives. Include a team-owned PR and a PR also stored for your personal
account. In the network panel, confirm the update arrives on the Soup GraphQL
subscription without triggering a refetch of every Soup list. Replaying an
unchanged webhook should not produce another Soup update. The PR detail's
separate diff and discussion requests are outside this subscription behavior.
