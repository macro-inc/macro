# ideas

## What it is

The Ideas screens: the For you page (`/app/for-you`) and Home's Today strip
and top priorities, over the person's feed of ideas (`crates/ideas`). Desktop
only, behind `enable-ideas`.

## How it works

- `queries/ideas-source.ts` reads the feed (`GET /ideas`: open ideas and
  those done in the last day) from the scheduler service and decodes it into
  `core/idea.ts`; it reads again after each write and every few seconds
  while a run is under way. Views only see the `IdeasSource` contract in
  `context/`.
- `primitives/feed.ts` decides what a card's action does for its kind: a
  composer prompt opens the composer and accepts; a background prompt only
  accepts, which starts its run; an entity idea opens its item or draft and
  accepts; a routine idea saves its suggestion.
- `idea-actions.ts` is the only place that knows the app's splits, composer
  and routine suggestions.

## Start here

- `core/idea.ts`: the idea model, `ideaStatus`, feed order and filters.
- `primitives/feed.ts`: card actions and held dismissals.
- `route-views.tsx`, `home-ideas.tsx`: the two production compositions.

## Scope

- Owns: the For you route, its sidebar entry, and Home's ideas section.
- Not here: routine suggestion wording and saving →
  `features/routine-suggestions` (`useRoutineIdeaSuggestions`); recording that
  the person opened the app → the app shell.

## Checks

- `bun --bun ../../node_modules/vitest/vitest.mjs run src/features/ideas` from `apps/web`.
- `bunx playwright test --config src/features/ideas/browser-test/playwright.config.ts`
  from `apps/web`: both screens over a scripted source, dark and light.

## Gotchas

- Clicking Run on a background idea is the approval: the card must show
  `sends` (or that it sends nothing) before Run, and there is no approval UI.
- The server has no un-dismiss. A dismissal is held with Undo and sent a few
  seconds after the last one, or when the person leaves (`sendDismissals`,
  with `keepalive` on unload). Splits can stay mounted after navigating away,
  so leaving alone would not send it.
- The feed keeps the server's order (most important first); only done ideas
  move, to the end. The server decides what is done: accepting anything but a
  background idea makes it `done`. An `accepted` background idea with no run
  was taken on for the person by an agent; it stays open and Run starts it.
- Accept sends the idea's `updatedAt` as the card read it. If the idea was
  rewritten since, the server refuses (409): the source reads the feed again
  and answers `changed`, and the card shows the new text with a note, so Run
  never starts text the person didn't see.
- The page follows the chosen design frames: one column; a card is a tile,
  title, state badge and time, one sentence, one block for its kind (prompt
  quote, drafted reply, routine sentence, a finished run's result), then
  source chips and actions. Done ideas sit under "Done today", dismissed ones
  under "Dismissed". The parts that read the app's items (`IdeaItemParts`:
  source chip, draft text, result) are supplied by `idea-items.tsx`.
- Violet marks what AI picked (a routine's values) and the dot on an idea new
  since the last visit.
- Gate every entry point with `useIdeasFlag`, which is also false on touch.
