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
- The page is up to four cards under Today and the date, each in the
  server's order: Suggestions (open prompts and routines: work Macro can
  do), To do (open entity suggestions: the person's own mail and documents),
  Running (`running` and `failed`) and Done today (`done`). A card with no
  row is not drawn. While something waits or runs, Done today shows the
  latest finished one and folds the earlier ones behind its footer's
  "N earlier today" button; with nothing waiting or running, a card says so and every
  finished one is listed. Refresh sits in the bar above the page
  (`ForYouRefresh`).
- The cards are `Card variant="filled" depth={3}` and the rows `Item
  size="sm"` with `border-0`, a medium `text-sm` title and one dimmer 13px line
  (`text-ink-extra-muted`). Both stay on one line, cut where the row ends,
  so every row is the same height; pointing at a cut line shows all of it
  (`Cut`).
  Don't give them local surfaces, borders, counts or descriptions beside
  the card's title. `for-you.browser.e2e.ts` holds the row's height and type
  sizes.
- A Suggestions row (`MacroRow`) leads with its kind's mark (a violet
  sparkle, an orange repeat for a routine, a spinner while running, a red
  mark once failed), says what Macro will do, and has one secondary button:
  Run, Open chat, Turn on, Retry, or View while it runs. Running and failed
  runs are the same row in the Running card. Beside the button sits a ghost
  Open chat (a run) or Review (a routine), and pressing the row's text does
  the same. Both look
  without taking it up (`feed.look`): a routine opens for review, a run
  under way opens its session, and a prompt opens in the composer.
- A To do row (`ToDoRow`) leads with a circle that marks it done without
  opening anything (`feed.markDone`; the server counts that as taken up,
  like Open). On a reply the circle is a plain mark with a tooltip, not a
  button: taking a reply up doesn't finish it (`doneWhenTakenUp`), only the
  person's reply does. Its line names the item it is about (`SuggestionItemParts`'
  `Source`, supplied by `suggestion-items.tsx`, the one part that reads the
  app's items; the summary where the viewer can't read the item), who wrote,
  and that a reply is drafted. Its button is Open or Open draft; pressing
  the text opens it too. Rows don't open in place.
- A Done today row (`DoneRow`) is a green check, a quieter title, what was
  done and when; pressing its text opens what it left (`feed.open`).
- A row that waits or runs shows only its age at rest, right-aligned
  (`RowEnd`; a running one shows when its run started). Pointing at the row
  or focusing in it shows its buttons, and dismiss takes the age's place at
  the row's end. The buttons keep their room while hidden, so nothing in the
  row moves; don't size or show them conditionally. Done today rows show
  their time and nothing else, and a dismissed row keeps Undo in view.
- Nothing on a row is loud: actions are `secondary` or `ghost` buttons (no
  `primary`), and colour is left to the kind's mark and a failed run.
- The API has no due times; a to-do's "2 days" is the feed's `waitingSince`,
  or when the suggestion arrived without it (`ageLabel`).
- Rows are kept by suggestion id (`Key`), so a feed read updates a row in
  place: don't key a branch on an object that is rebuilt on every read. A
  row whose status changes moves to another card's list and is rebuilt.
- What a card holds belongs to the account that read it. Accept and
  regenerate compare the signed-in account before acting on an answer.
- Every change to the feed also invalidates Home's rows
  (`suggestionsKeys.top`), which are a separate read.
- Gate every entry point with `useSuggestionsFlag`, which is also false on touch.
