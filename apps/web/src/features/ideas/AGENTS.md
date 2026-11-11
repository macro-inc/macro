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
  composer prompt accepts, then opens the composer; a background prompt only
  accepts, which starts its run; an entity idea accepts, then opens its item
  or draft; a routine idea saves its suggestion.
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
  rewritten since, the server refuses (409) and answers with the idea as it
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
- A card shows only what the person needs to act: the title, one sentence,
  and one quiet line of facts beside one main action. A block appears only
  when it must be read first: the prompt a background run will follow (with
  what it sends) and a drafted reply. A composer idea shows no prompt (the
  composer does), a running one no prompt, and every finished idea is one
  row. The parts that read the app's items (`IdeaItemParts`: source link,
  draft text, waiting time) are supplied by `idea-items.tsx`.
- Nothing on a card is loud: the main action is the app's `secondary`
  button and the other a `ghost` one (no `primary`: several white buttons on
  one page read as shouting), tile and line icons take the muted ink, and
  dismiss shows on hover or keyboard focus. Colour is left to the state
  badges and the values AI picked.
- User-visible text says "suggestion", not "idea"; the code keeps `idea`
  until the backend's rename lands.
- The API has no due or waiting times. A reply idea's "waiting 2 days" and
  the sender on its chip come from the email thread itself
  (`queries/idea-thread.ts`, `core/thread.ts`): the last message, when the
  person didn't write it. Without that, a card shows when the idea arrived.
- Violet marks what AI picked (a routine's values) and the dot on an idea new
  since the last visit.
- Gate every entry point with `useIdeasFlag`, which is also false on touch.
