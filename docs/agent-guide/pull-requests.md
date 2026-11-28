# Pull requests

## Pull requests — `/app/reviews/pr/<foreignEntityId>`

Opening **Reviews** from the mobile dock or its **More** drawer starts on **Pull
requests** (the **All** scope). Explicit review-tab links keep their selected
scope; desktop's default scope remains **Involves me**.

The sidebar **Labels** section lists GitHub labels, not Macro tags. Keep this
section separate from Macro tag lists. GitHub labels are also available in
**Filter pull requests → Label** on desktop and **Open pull request filters →
Label** on phones.

For now, PR mentions (in messages, documents and Magic Chips) and an agent
session's PR chip open the pull request on GitHub, not this view: a new tab on
the web, the system browser in the desktop app. Reviews still opens it here.

Macro-linked GitHub pull requests open inside the Reviews shell. The docked app
sidebar keeps its normal collapse and expand behavior. The PR page has **Overview**
and **Changes** tabs, with GitHub addition/deletion totals on Changes. Switching
tabs replaces the content in the same pane; it does not open a nested split.
Old `/app/pr/<foreignEntityId>` links still redirect into Reviews, and copied
links use `/app/reviews/pr/<foreignEntityId>`.

## Header and Details

The lifecycle icon shows open, draft, merged, or closed. The header's top fade
also reflects requested changes and failing checks, without replacing the
lifecycle icon. The title wraps rather than truncates. Its checks icon summarizes
stored check runs; activating it opens a checks-only dialog.

The pills show the author, opened date when known, a GitHub link, branch names,
linked tasks, and GitHub labels. The GitHub link retains its number and external
link icon at narrow widths. The branch pill opens the full head and base names
with separate copy actions. The default base branch is omitted only when known.
Optional backend data stays hidden until available; missing dates or reviewers
are never guessed.

At 1224px of PR-pane width, Overview can dock **Details** on the right. The
header toggle remembers whether the column is shown without moving the text's
left edge. Below that width, and always on Changes, the toggle opens the floating
Details popover anchored below its toggle instead of at the window edge.
Escape or the toggle closes it. Its transient open state is independent of
the remembered docked-column choice. On phones, the Info island
opens Details in a drawer. The drawer reuses the same checks, reviewer, stack,
label, and linked-work lists with touch-size rows. Missing sections stay hidden.

Above 1440px of PR-pane width, the header and content use a centered 1376px
container with side hairlines beneath the band. All breakpoints use the PR pane,
not the browser window, so split panes and the app sidebar remain supported.

## Overview

Overview shows the GitHub Markdown description, then Discussion and the merge
box. Long bodies collapse behind **Show more**. GitHub-hosted description and
comment images use the shared Markdown image handling. **Hide bots** removes bot
comments rather than replacing them with a collapsed bot row. Submitted reviews
show their available state, including compact body-free events. Stored review
comments retain their thread grouping and file reference. Suggested-change fences
render as display-only suggestion blocks.

The merge box summarizes checks. Lists order pending checks first, show up to
five rows initially, and offer **Show all checks** for the rest. Each row shows
status, duration, and an external link. Its merge
action stays gray and disabled while unavailable; only an active merge is green.
An author's pending reviewers appear when reviewer data is available. Existing
merge, draft, close, and reopen actions keep GitHub's permission and branch
protection checks. Merge asks for confirmation, and refusals use the existing
toast feedback. **Ask Macro**, sharing, and the title menu retain their existing
app actions. Ask Macro, labeled Share, and Details sit at the top bar's right
end. Phone title menus also include Ask Macro and existing lifecycle actions.
PRs remain separate from Tasks and cannot be favorited.

## Changes

Changes displays the captured patch through the shared diff renderer. The file
tree docks on the right from 1162px of PR content-container width; below that the tree
opens in a popover. Search and filters belong to its header. Selecting a file
reveals that file in the diff. Hiding the tree gives its width back to the diff.
This PR-specific composition does not change the agent-session Changes pane.

The diff toolbar sticks below the page chrome. It offers Unified/Split when the
diff has enough width, collapse/expand all, refresh, and the tree toggle. Below
720px the diff is unified only; the narrowest toolbar folds secondary controls
into a menu. Each file header shows its name before its directory, status,
addition/deletion totals, copy-path action, and stored review-comment count.
Sticky file headers are opaque; the file-tree header matches the toolbar background.
Changes does not add a back button.
New captures expand files with at most 40 changed lines; explicit collapse
choices for that capture take precedence.

On desktop, scrolling down beyond the title band replaces the full header with
a slim bar containing the title, state, checks, tabs, and merge action. Scrolling
up reveals the app top bar again and moves the sticky toolbar and file headers
with it. Header rows and inverse scroll spacers share a 200ms transition to
preserve the scroll range without a layout jump. Reduced motion disables both
transitions. Each tab retains its own scroll chrome; tab changes restore that
layout without interpolating between unrelated scroll positions.
The slim bar does not add a second Details toggle. Phones keep their
MobileHeader islands and pin touch-size tabs beneath them instead of using a
slim bar. Bottom review actions use the pane's floating chrome region.

## Unavailable review capabilities

Stack chains, timeline pushes, merge-when-ready, re-running checks, commenting,
replying, pending review comments, submitting reviews, resolving threads,
committing suggestions, viewed-file state, commit statuses, required checks, and
linking tasks from this page require additional backend support. Their typed
sources return no data and their actions are hidden or unavailable; the page
does not claim to persist local substitutes.

Development previews can enable synthetic states with `?pr-samples=1`. The
choice is remembered for the session; `?pr-samples=0` turns it off. The switch is
restricted to local Vite development and the hosted development environment.
Sample actions change only sample state and never write to GitHub. Use neutral
sample records to inspect the review island, review form, sheets, and missing
backend states. Sample mode is unavailable against production.
Use `pr-scenario` with `open`, `draft`, `merged`, `closed`, `changes-requested`,
`failing-checks`, `review-draft`, or `file-progress`. Author merge states use
`author-merge` (running), `author-failing`, `author-waiting` (passed checks),
and `author-ready`; reviewer states use `reviewer-merge` (running),
`reviewer-failing`, and `reviewer-ready`. Reload after changing the scenario.
The sample changeset contains 12 files; `file-progress` starts with three viewed.
Draft file comments remain separate until review submission. Replies retain
thread anchors, and resolving a sample thread removes all its replies.
Sample mode disables live sharing instead of forwarding a real entity.
Its safe state menu supports ready-for-review, draft, close, reopen, and merge
without offering generic actions against a synthetic entity.

Browser and touch verification use the running preview. Check tab alignment,
sidebar-open and collapsed widths, a second split, Details docking and Escape,
branch copying, check links, hide-bots behavior, scroll direction, narrow diff
controls, phone safe areas, and drawer focus restoration. A failed first load
shows a local Retry control without blanking unrelated app chrome.
Description screenshots hosted on GitHub (including `blob/…?raw=true` links)
render in the body, in the browser and the desktop app; they must not show
"This image could not be found."

PR metadata changes should update an already loaded Reviews list row and the
linked agent session's PR status without reloading the page. To verify, keep
both rows visible and change the PR in GitHub; check the status after the
webhook arrives. Include a team-owned PR and a PR also stored for your personal
account. In the network panel, confirm the update arrives on the Soup GraphQL
subscription without triggering a refetch of every Soup list. Replaying an
unchanged webhook should not produce another Soup update. The PR detail's
separate diff and discussion requests are outside this subscription behavior.

Opening a pull request from Home clears its loaded unread notifications immediately,
including desktop previews, keyboard activation, j/k navigation, and phone taps.
Keyboard browsing marks the row when its debounced preview actually opens;
marking a row done also marks the next PR read when it opens. A failed read
write restores the unread dot; opening the row again retries it. The detail
view also marks the whole pull request read on mount, without an extra delay.
