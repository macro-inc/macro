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
- `primitives/feed.ts` decides what a card's action does for its kind: a
  composer prompt accepts, then opens the composer; a background prompt only
  accepts, which starts its run; an entity suggestion accepts, then opens its item
  or draft; a routine suggestion saves its drafted routine.
- `suggestion-actions.ts` is the only place that knows the app's splits, composer
  and routine suggestions.
- The first generation starts in onboarding, not here: connecting an inbox
  calls `/suggestions/generate` once when either the person's suggestions or
  routine suggestions are on (`features/onboarding`,
  `useSuggestionGenerationEnabled`).

## Start here

- `core/suggestion.ts`: the suggestion and feed model, the tab filter.
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

- Clicking Run on a background suggestion is the approval: the card must show
  `sends` (or that it sends nothing) before Run, and there is no approval UI.
- The server decides and the page shows: each suggestion's `status`, the
  feed's order (what waits or runs, then what is done), the tab `counts`,
  `isNew`, what a finished one left (`result`, absent until its run
  settled), and a reply's `waitingSince`, `from` and draft `preview`. Don't
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
- The page follows the chosen design frames: one column of cards, then
  "Done today" and "Dismissed". Every card is the app's `Card` from `@ui`
  (`variant="filled" depth={3}`, as the routine cards) built from its own
  parts: `Card.Header` with an `Item` (`Item.Media` tile, `Card.Title`,
  `Card.Description`), an optional `Card.Body` holding a nested
  `Card variant="filled" offset={1}`, and `Card.Footer` with `Card.Metadata`
  and `Card.Actions`. Don't restyle these with local surface, border or type
  classes.
- A card shows only what the person needs to act: the title, one block of
  text, and one quiet line of facts beside one main action. There is never a
  second block repeating the first: a background run shows its summary and
  what it sends, not its prompt (Open in chat shows that); a drafted reply
  shows the draft in place of the summary; every finished suggestion is one
  row. The one part that reads the app's items (`SuggestionItemParts`: the
  source link's icon and name) is supplied by `suggestion-items.tsx`.
- Nothing on a card is loud: the main action is the app's `secondary`
  button and the other a `ghost` one (no `primary`: several white buttons on
  one page read as shouting), line icons take the muted ink, and dismiss
  shows on hover or keyboard focus. Colour is left to the tile (each kind has
  its own, from the routine cards' tints), the state badges and the values
  AI picked.
- The API has no due times; a reply's "waiting 2 days" is the feed's
  `waitingSince`. Without it a card shows when the suggestion arrived.
- Gate every entry point with `useSuggestionsFlag`, which is also false on touch.
