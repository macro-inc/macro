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
  runs. The feed is read again after each write, every 10 s while a
  run or a generation is under way, and once when a generation ends. Nothing
  else polls; `queries/polling.test.tsx` holds these numbers.
- `primitives/refresh.ts` and `components/refresh-suggestions.tsx` are the
  header's Refresh control (`POST /suggestions/regenerate`): running while a
  generation runs, "Available at h:mm" during the hourly cooldown (one timer
  ends it), hidden where the server has no status to give.
- `primitives/feed.ts` holds each list's rows (`view(list)`, `counts()`)
  and decides what a row's action does for its kind: a composer prompt
  accepts, then opens the composer; a background prompt only accepts, which
  starts its run; an entity suggestion accepts, then opens its item
  or draft; a routine suggestion saves its drafted routine. Whether a row is
  then done is the server's: a reply suggestion stays open until the person
  replies on its thread (the browser fixture's Send replies plays that).
  `look` opens what a prompt or routine would do without accepting it, and
  `open` what a finished one left.
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

- `core/suggestion.ts`: the suggestion and feed model.
- `primitives/feed.ts`: the lists, row actions, dismiss and undo.
- `core/lists.ts`: which list holds a suggestion, and a row's states.
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

- Clicking Run on a background suggestion is the approval, and there is no
  approval UI: a run that posts or sends something leads its line with
  `sends`, so it is read before Run and is never the part a long line cuts
  off; it stays there while the run is under way and after it failed, since
  Retry sends it again. A run that sends nothing doesn't say so.
- The server decides and the page shows: each suggestion's `status`, the
  feed's order (what waits or runs, then what is done), `isNew`, what a
  finished one left (`result`, absent until its run
  settled), a reply's `waitingSince`, `from` and draft `preview`, and a
  routine suggestion's `routine` sentence and when-line. Don't
  derive any of these here. Home asks for its rows with `?limit=5`
  (`queries/top-suggestions.ts`).
- A dismissal is sent at once; the suggestion stays as a row for the visit,
  and Undo calls `POST /suggestions/{id}/restore`, which the server allows
  for a few minutes. A refused dismissal leaves the row with the
  failed-action line; a refused Undo says it may be too late. Dismissing a
  running suggestion stops its run (the control and the row say so), and
  restoring it brings it back open, not running.
- Leaving For you calls `POST /suggestions/viewed` (also on `pagehide`, with
  `keepalive`): what is proposed after that is new next time.
- Accept sends the suggestion's `updatedAt` as the row read it. If the suggestion was
  rewritten since, the server refuses (409) and answers with the suggestion as it
  is now: the source puts that in the feed and answers `changed`, and the
  row shows the new text with a note, so nothing is taken up or run on text
  the person didn't see.
- The page is a sidebar of lists and the chosen list (`?view=`, Today by
  default) under its name and the date (`views/for-you-view.tsx`,
  `components/for-you-sidebar.tsx`). `core/lists.ts` says which suggestions
  each list holds: Today all that wait or run, To do entity suggestions,
  Suggestions prompts and routines, Done what the server lists as done. Each
  list's count is the server's (`counts`), so a row that settles here stops
  being counted while it stays in view. The sidebar's Routines links
  (`queries/routines-source.ts`: idea and routine counts, a routine's
  switch) open Agents → Routines; `features/routines` and
  `features/routine-suggestions` own those screens, so only import from them.
- What waits or runs, and what settles or is dismissed during the visit,
  stays where it was until the person leaves (`core/hold.ts`); its row
  shows the settled state (`RowState`): marked done (struck through, with
  Undo while the page can restore it), a finished run (a green check and
  the one line its run reported, `run.report`, else its summary), a routine
  turned on (a green dot and when it runs, Edit and the routine's switch),
  or dismissed (Undo). With nothing waiting in Today, the page says "You’re
  all caught up" above whatever settled here.
- Every row is one `components/suggestion-row.tsx`: an `Item size="sm"`
  with `border-0`, 56px whatever its state (`h-14`), a 32px tile tinted by
  the suggestion's kind (`suggestionLook`), a medium `text-sm` title and one
  dimmer 13px line (`text-ink-extra-muted`). Both stay on one line, cut
  where the row ends; pointing at a cut line shows all of it (`Cut`). A
  failed action or a rewritten suggestion replaces the line with its note.
  The rows sit flat on the page: no cards, outlines, or local surfaces.
  `for-you.browser.e2e.ts` holds that every row in a list is the same
  height.
- A row that waits or runs shows only its age at rest, right-aligned
  (`RowEnd`). Pointing at the row or focusing in it shows its buttons
  (`data-suggestion-hover`): ✓ marks it done where taking it up finishes it
  (`doneWhenTakenUp`; never a reply, whose person's reply finishes it, or a
  run, which taking up starts), ✕ dismisses, then its action. The buttons
  keep their room while hidden, so nothing in the row moves; don't size or
  show them conditionally.
- A row's action, by kind: Run, Open chat, Turn on or Retry for work Macro
  can do; Open or Open draft for a to-do; Stop while a run is under way
  (`feed.stop`; the run's `stopping` flag reads "Stopping…" until the
  server opens it again); Open on a finished run. Pressing a waiting
  prompt's or routine's text looks without taking it up (`feed.look`); a
  to-do's opens it; a settled one's opens what it left (`feed.open`). Rows
  don't open in place.
- Marking done and turning a routine on each show a toast: Undo for the
  first, View routine (the saved routine, `savedRoutineId`) for the second.
- Nothing on a row is loud: actions are `secondary` or `ghost` buttons (no
  `primary`), and colour is left to the kind's tile, the settled marks and a
  failed run.
- The API has no due times; a to-do's "2 days" is the feed's `waitingSince`,
  or when the suggestion arrived without it (`ageLabel`).
- Rows are kept by suggestion id (`Key`), so a feed read updates a row in
  place: don't key a branch on an object that is rebuilt on every read. A
  row keeps its place when its status changes.
- What a row holds belongs to the account that read it. Accept and
  regenerate compare the signed-in account before acting on an answer.
- Every change to the feed also invalidates Home's rows
  (`suggestionsKeys.top`), which are a separate read.
- Gate every entry point with `useSuggestionsFlag`, which is also false on touch.
