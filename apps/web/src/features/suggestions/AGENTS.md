# suggestions

## What it is

The Suggestions screens: the For you page (`/app/for-you`) and Home's Today strip
and top priorities, over the person's feed of suggestions (`crates/suggestions`). Desktop
only, behind `enable-suggestions`.

## How it works

- `queries/suggestions-source.ts` reads the feed (`GET /suggestions`: open suggestions and
  those done in the last day) from the scheduler service and decodes it into
  `core/suggestion.ts`. Views only see the `SuggestionsSource` contract in
  `context/`.
- Polling is narrow on purpose. `queries/generation.ts` reads
  `GET /suggestions/generation` once, then every 3 s only while a generation
  runs. The feed is read again after each write, every 10 s while a card's
  run or a generation is under way, and once when a generation ends. Nothing
  else polls; `queries/polling.test.tsx` holds these numbers.
- `primitives/refresh.ts` and `components/refresh-suggestions.tsx` are the
  header's Refresh control (`POST /suggestions/regenerate`): running while a
  generation runs, "Available at h:mm" during the hourly cooldown (one timer
  ends it), hidden where the server has no status to give.
- `primitives/feed.ts` decides what a row's action does for its kind: a
  composer prompt accepts, then opens the composer; a background prompt only
  accepts, which starts its run; an entity suggestion accepts, then opens its item
  or draft; a routine suggestion saves its drafted routine.
- `suggestion-actions.ts` is the only place that knows the app's splits, composer
  and routine suggestions.
- `draft-origin.tsx` is the footer the email thread draws under a reply
  draft a session wrote (`rendering.renderDraftOrigin`, supplied in
  `features/email-thread/email-thread.tsx`). `draftOrigin` in
  `core/suggestion.ts` finds the feed's suggestion, open or done, whose draft
  is that message; `queries/draft-origin.ts` reads the feed's own entry and
  never polls. The bar links the suggestion's other `about` items, and
  Rewrite opens the agent composer with the thread mentioned and the request
  typed, unsent. A send time takes the card's footer instead, and a draft
  whose suggestion has left the feed (done over a day ago) has none.
- The first generation starts in onboarding, not here: connecting an inbox
  calls `/suggestions/generate` once when either the person's suggestions or
  routine suggestions are on (`features/onboarding`,
  `useSuggestionGenerationEnabled`).

## Start here

- `core/suggestion.ts`: the suggestion and feed model, the section counts.
- `primitives/feed.ts`: card actions, dismiss and undo.
- `route-views.tsx`, `home-priorities.tsx`: the two production compositions.

## Scope

- Owns: the For you route, its sidebar entry, and Home's suggestions section.
- Not here: routine suggestion wording and saving →
  `features/routine-suggestions` (`useForYouRoutineSuggestions`); recording that
  the person opened the app → the app shell.

## Checks

- `bun --bun ../../node_modules/vitest/vitest.mjs run src/features/suggestions` from `apps/web`.
- `bunx playwright test --config src/features/suggestions/browser-test/playwright.config.ts`
  from `apps/web`: both screens over a scripted source, dark and light.

## Gotchas

- Clicking Run on a background suggestion is the approval: the row must show
  `sends` (or that it sends nothing) before Run, and there is no approval UI.
- The server decides and the page shows: each suggestion's `status`, the
  feed's order (what waits or runs, then what is done), the section `counts`,
  `isNew`, what a finished one left (`result`, absent until its run
  settled), a reply's `waitingSince`, `from` and draft `preview`, and a
  routine suggestion's `routine` sentence and when-line. Don't
  derive any of these here. Home asks for its rows with `?limit=5`
  (`queries/top-suggestions.ts`).
- A dismissal is sent at once; the suggestion stays as a row for the visit,
  and Undo calls `POST /suggestions/{id}/restore`, which the server allows
  for a few minutes. A refused dismissal leaves the card with the
  failed-action line; a refused Undo says it may be too late. Dismissing a
  running suggestion stops its run (the control and the row say so), and
  restoring it brings it back open, not running.
- Leaving For you calls `POST /suggestions/viewed` (also on `pagehide`, with
  `keepalive`): what is proposed after that is new next time.
- Accept sends the suggestion's `updatedAt` as the card read it. If the suggestion was
  rewritten since, the server refuses (409) and answers with the suggestion as it
  is now: the source puts that in the feed and answers `changed`, and the
  card shows the new text with a note, so nothing is taken up or run on text
  the person didn't see.
- The page is one list in sections by status, each in the server's order:
  To do (`open`), Running (`running` and `failed`), Done today (`done`),
  then Dismissed for the visit. The header and the section headings show the
  server's counts (`sectionCounts`); with nothing waiting or running, a card
  says so above what was done. Rows are the app's `Item` from `@ui`
  (`Item.Icon`, `Item.Title`, `Item.Description`, `Item.Metadata`); an opened
  row is `variant="filled" depth={3}` and its draft a nested
  `Card variant="filled" offset={1}`. Don't restyle these with local surface,
  border or type classes.
- A row shows only what the person needs to act: its kind's glyph (or its
  run's state), the title, one line of text, and a quiet fact over its one
  action. A background run also shows what it sends, not its prompt (Open in
  chat shows that). Pressing a row's text opens it in place, one at a time
  (the one opened from Home to begin with): its source link, a drafted
  reply's draft, and its other actions (Review, Open in chat). Every finished
  suggestion is one line. The one part that reads the app's items
  (`SuggestionItemParts`: the source link's icon and name) is supplied by
  `suggestion-items.tsx`.
- Nothing on a row is loud: its action is the app's `link` button, an opened
  row's other actions are `secondary` (no `primary`), line icons take the
  muted ink, and dismiss shows on hover or keyboard focus. Colour is left to
  the glyph (each kind has its own, from the routine cards' tints), a failed
  run and the values AI picked.
- The API has no due times; a reply's "waiting 2 days" is the feed's
  `waitingSince`. Without it a card shows when the suggestion arrived.
- Rows are kept by suggestion id (`Key`), so a feed read updates a row in
  place: don't key a branch on an object that is rebuilt on every read. A
  row whose status changes moves to another section's list and is rebuilt.
- What a card holds belongs to the account that read it. Accept and
  regenerate compare the signed-in account before acting on an answer.
- Every change to the feed also invalidates Home's rows
  (`suggestionsKeys.top`), which are a separate read.
- Gate every entry point with `useSuggestionsFlag`, which is also false on touch.
