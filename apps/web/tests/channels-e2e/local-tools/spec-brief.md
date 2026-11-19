# Brief: writing specs for the channels full-stack suite

Repo worktree: /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base (branch synoet/channels-e2e-base).
Suite: apps/web/tests/channels-e2e/ (read EVERY file there first: playwright.config.ts, harness/*.ts, open.spec.ts,
location.spec.ts, scroll.spec.ts). It is a Playwright suite that drives the real Macro web app against a whole local
stack, with four seeded people: ada (team owner; the default `page` is hers), ben and cy (same team), dee (outside the team).
Fixtures (`harness/fixtures.ts`): `page`, `ada`/`ben`/`cy`/`dee` (an `Api` per person, `harness/api.ts`), `people`,
`pageFor(key)` (a page in that person's own browser profile), `history` (a long read-only channel; never write to it).
`ChannelView` (`harness/channel.ts`) is the page object for an open channel.

## Purpose
The suite must prove channels work for real users, and it will be run unchanged against a large rewrite of how channel
messages are stored and synced in the browser (messages read from a local index, written through GraphQL instead of REST).
So tests must assert only what a person sees and does: visible messages, their order, completeness, counts, names, buttons.
NEVER assert on network requests, REST URLs, query caches, or internal state, and never wait on a request/response
(`waitForResponse` etc.) - the rewrite changes all of those. Two real people in two browser profiles is the norm for
anything live: one acts (through the UI when the action is what the test is about, through `Api` when it only sets the scene
or plays the other person), the other's page must show the result without a reload.

## Rules (the repo's CODING.md test rules apply; read /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base/CODING.md "tests" part)
- No sleeps, no `waitForTimeout`, no polling loops of your own: use web-first assertions (`expect(locator)...`),
  `expect.poll`, `expect(async () => ...).toPass()`.
- Explicit literals in assertions (`toEqual(['one', 'two'])`), no logic that recomputes the expected value.
- Each test: title starts with an id `AREA-NN ` (areas given in your task), a sentence a person would say; directly above it
  a comment `// If this fails, <what a user would suffer>.`
- Each test makes its own channel(s) via `ada.createChannel(...)` (unique names by default). Tests run fully parallel
  against one shared stack; never depend on another test, on global counts, or on the sidebar being otherwise empty.
- Find things the way a person does: role + accessible name, visible text, then the app's stable `data-*` hooks
  (listed below). No CSS classes, no nth-child.
- Never write Python (not even a one-liner). Shell + jq, or TypeScript.
- Do NOT edit shared harness files (`harness/channel.ts`, `api.ts`, `fixtures.ts`, `people.ts`, `stack.ts`, `history.ts`),
  `playwright.config.ts`, or other agents' spec files: others are editing in parallel. Put helpers you need in a NEW file
  `harness/<your-area>.ts` (you may subclass/wrap `ChannelView` and `Api`; for extra service calls build on
  `apiFor(key)` from `harness/people.ts`). In your final report list anything that should be promoted to the shared harness.
- Do not change product code (`apps/web/src`, services). If the product misbehaves, that is a finding (see below).
- Do not commit, push, or run git stash. Leave your files uncommitted; I commit.
- Only stack you may touch: https://localhost:22609 (instance che2e-main). Do not start/stop/rebuild any stack, and do not
  touch any other port or instance.

## Running
`RUN_TAG=<your tag> ~/.cache/channels-e2e/run.sh 22609 <file.spec.ts> [-g "ID"]` (from anywhere). Pipe through
`grep -v socat | grep "✓\|✘\|passed\|failed\|flaky"` for a summary; failures:
`~/.cache/channels-e2e/fails.sh ~/.cache/channels-e2e/runs/22609-<tag>/playwright-report.json` (LINES_PER=n for more lines).
Failed tests leave a screenshot, `error-context.md` (an aria snapshot of the page - very useful to learn the DOM) and a
trace under `~/.cache/channels-e2e/runs/22609-<tag>/test-results/`. Read screenshots with the Read tool.
To learn the DOM of a surface, write a throwaway `zz-<tag>-probe.spec.ts` that opens it and prints
`await page.locator('...').evaluate(n => n.outerHTML)` or `await page.locator('body').ariaSnapshot()`; delete it after.
Format before finishing: `cd apps/web && nix develop -c bunx biome check --write tests/channels-e2e/<your files>`
(fix what it reports; for Playwright's `async ({}, use)` see the biome-ignore in fixtures.ts).
When done, run each of your spec files 3 times in a row; all must pass every time (a flaky test is a failed task - find
the real cause, do not add retries or longer timeouts to hide it).

## Things already learned the hard way
- The message list is virtualised: only rows near the window exist in the DOM. A message below/above the window is not
  attached. `view.texts()` reads what is drawn; `view.drawnTexts()` waits for text to be drawn.
- A message's row is drawn a moment before its text.
- "Scroll to bottom" shows only while scrolling down from more than a screen above the end, and not while an
  "unread above" chip shows (`view.scrollDownUntilOffered()`).
- The mark on a link's target message (`data-targeted`) lasts one second (`view.noteMarkedMessages()` / `expectMarked`).
- Toasts are transient: assert them before waiting for anything slow.
- Browser contexts need the `login=true` cookie (already in the saved sessions).
- The gateway only delivers live events to a page that pinged within 60 s; pages are visible in headless Chromium, fine.
- User ids are `macro|<email>`; `people.ben.userId`, `people.ben.name` ("Ben Member"), `people.ada.name` ("Ada Owner").
- Service API (through the stack origin; `Api` wraps most): `POST /dss/channels {channel_type: public|private|direct_message|team,
  name?, participants:[userIds], team_id?}`; `POST /dss/messages/channel/<id> {content, thread_id?, mentions?, attachments?}`;
  `PATCH|DELETE /dss/messages/channel/<id>/items/<mid>`; `POST .../items/<mid>/reactions {emoji, add}`;
  `POST .../typing {thread_id, active}`; `POST|DELETE /dss/channels/<id>/participants {participants}`;
  `PATCH /dss/channels/<id> {channel_name}`; `DELETE /dss/channels/<id>`; `/dss/channels/<id>/join`; access-request endpoints
  (see `apps/web/src/lib/service-clients/service-storage/client.ts`). Seed sequentially (the rewrite may answer 503 to more
  than 4 writes in flight per channel).
- Known product defect on main (already recorded): reading forward from an old deep-linked message jumps to the end.

## DOM hooks seen live (route `/app/channel/<id>`)
List `[data-channel-scroll]`, rows `[data-channel-thread-row]`, `[data-message][data-message-id]`, `[data-message-content]`,
`[data-message-slot=header|content|footer]`, time `span[title]`, `button[aria-label="Reply"]`, `[data-message-reactions-row]`,
`[data-message-reaction-chip][data-emoji]`, `aria-label="Add reaction"`; hover actions `[data-message-hover-actions]` with
`[data-message-action="reply|react-quick|copy-link|copy-message-text|edit|delete|create-task|chat"]` (`view.action(message, name)`);
edit editor `[data-input-id="edit-message-input-<id>"]`; delete dialog "Delete message"; deleted placeholder
"This message was deleted."; "(edited)"; threads: `button[title="Expand thread"]`, reply composer
`[data-input-id="thread-reply-input-<rootId>"]` placeholder "Send a reply"; composer `[data-input-id="channel-input-<id>"]`,
`[contenteditable]` textbox with aria-label "Type @ to share with #<name>", send `[data-input-action="send"]` ("Send message"),
"Add" menu `[data-composer-menu-anchor]`, hidden file input `input[data-collapsed-input-file-picker]`,
`[data-input-attachments]`, `[data-message-attachments]`; drafts persist in localStorage; mention chips
`[data-user-mention][data-user-id]`, `[data-document-mention]`; typing text "<name> is typing" (8 s expiry, not in threads);
system lines `[data-system-activity]` ("renamed the channel to", "joined the channel", "added", "removed");
"New" divider with `button[title="Mark as read"]` (only for others' messages newer than the reader's last view);
unread chip aria `"{n} unread notification stack(s) above|below"`; sidebar `aside[aria-label="Chat navigation"]`,
tree "Conversations", rows `div[data-key="channel:<id>"] [role=treeitem]`, `span[aria-label="Unread"]`, sections
Favorites / Direct messages / <Team name> channels / All channels, button "Create channel or direct message";
header button "Channel actions" (Rename, Favorite, Mute, Copy Link, Delete), tabs Messages / Attachments / Calls / Participants,
buttons "Call", "Invite"; create-channel modal ("Create a channel", `#new-channel-name`, Visibility Team/Private, Next/Create,
"Skip for now"); access: "Ask to join", "Withdraw request", "Approve"/"Deny"; find bar (`cmd+f`/`ctrl+f`, placeholder
"Find", "Next match"/"Previous match"/"Close find bar"); list hotkeys with a message selected: arrows, Enter reply, `e` edit,
Backspace delete, Escape. These came from reading code and one live look; verify each on the live page before relying on
it. Product source: apps/web/src/features/channel/** (Channel/, Message/, Thread/, Input/, components/rail/), queries in
apps/web/src/lib/queries/messages and queries/channel. docs/agent-guide/channels.md describes the surfaces.

## Product findings
If the product does something a user would call wrong (lost/duplicated/misordered message, stale count, action with no
effect), do NOT weaken the test to pass. First make sure it is the product and not the test (reproduce at human speed in a
probe, look at the screenshot). Then keep the test asserting the right behaviour, mark it with `test.fail()` plus a comment
describing the defect in one or two sentences, and report it. If something is merely absent from the UI, say so in the
report instead of testing it.

## Final report (your last message; keep it short and factual)
1. Table: test id | title | what it proves.
2. Product findings (with the evidence path: screenshot/trace).
3. Behaviours in your area you did NOT cover and why.
4. Helpers that should move to the shared harness.
5. Result of the three consecutive runs per file (pass counts).
