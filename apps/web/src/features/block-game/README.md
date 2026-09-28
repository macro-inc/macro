# Games

Quick games to play with teammates while agents work. Every game is a room: a
native `game` document shared, sent to channels, favorited and moved like any
other document. Editors play and viewers watch. Lists, previews and channel
mentions show whether a room is waiting, in progress or finished, and each game
keeps a team leaderboard.

| Game | Players | Leaderboard |
| --- | --- | --- |
| Pong | 2, or practice against the computer | Team match wins |
| Brick Breaker | Solo | Team high score (points) |
| Snake | Solo | Team high score (points) |
| Falling Blocks | Solo | Team high score (points) |
| Invaders | Solo | Team high score (points) |
| Flappy | Solo | Team high score (pipes passed) |
| 2048 | Solo | Team high score (points) |
| Minesweeper | Solo | Team fastest clear |
| Tic-Tac-Toe | 2 | Team round wins |
| Connect Four | 2 | Team round wins |
| Dots and Boxes | 2–4 | Team round wins |
| Typing Race | 1–8 | Team best WPM |

Start a room from **Create → Game** (`Y`), which opens the Games hub at
`/app/games`, then pick a game. The room opens beside the hub; share it with
people or a channel to invite players. Rollout is gated by the `enable-games`
PostHog flag (`ENABLE_GAMES` locally; on by default in development).

## How a room works

A room is a Loro document on the sync service, like a spreadsheet. The backend
seeds new rooms with `static_assets/game-golden.1.bin`, and the creator's first
open records which game the room hosts (`gameMeta.kind`); a room opened before
that shows a game picker to editors.

- **Log replay.** Every action (join, move, forfeit, rematch, finished solo run,
  race start) is appended to one `gameLog` list. Each client replays the log with
  the game's rules, and moves that are illegal at their position are ignored.
  Concurrent actions therefore resolve the same way on every peer: two players
  racing for the last seat, or a move sent after the opponent already moved.
- **Race progress** lives in a separate `raceProgress` map so typing never
  rewrites the log.
- **Pong** is real time. The first seat's client runs the ball and records
  each point in the log (so the score replays like any turn game); it streams
  the ball and both paddles as presence about fifteen times a second. The
  second seat streams only its paddle and draws its own paddle immediately.
  Everyone else draws the host's snapshots, extrapolated between updates. A
  snapshot counts only while it keeps changing, so a closed tab's lingering
  presence is ignored; if the first seat has the room open in several tabs,
  the one open longest runs the ball and another takes over when it closes
  or goes to the background. A tab that missed part of a round (hidden,
  asleep, or opened in the background) rejoins as the newest and watches for
  a running tab before it may run the ball.
  Practice against the computer is local and never touches the log.
- **Arcade games** (Brick Breaker, Falling Blocks, Invaders, Flappy) run
  locally on an animation-frame loop and record a `run` when they end, like
  Snake. They pause when the board loses focus or the tab is hidden; Enter or
  **New game** starts over after a game ends.
- **Presence** (playing or watching, a solo player's live score) is ephemeral
  awareness, not document state.
- **Status.** Each room derives waiting, in progress or finished and stores it
  as the document's system Status. The client that caused a change publishes it
  after it settles. Other editors follow up later only if the stored value still
  differs, because every property write is recorded as document activity.
- **Results.** Finished solo runs and races submit a score. Every player's
  client reports each finished versus round, and a round counts once two of its
  players report the same result, so no one can record a win alone. A client
  vouches only for rounds it saw in progress with its player seated; it keeps
  them in local storage until reported, so a round that ends while a player is
  away is confirmed on their next visit, and failed reports are retried.

## Leaderboards and trust

`crates/games` owns scores and round wins (`game_best_score`,
`game_round_report`, `game_round_result`) behind `/games/*` on the document
storage service. Leaderboards rank the viewer's team's current members; a
player without a team sees only their own results. Scores are reported by the
game client, as in any casual in-browser game. The server bounds them per game,
only accepts rounds from editors of the room who played in it, keeps one report
per player, and counts a round once, when two players' reports agree.

## Layers

| Layer | Responsibility |
| --- | --- |
| `definition.ts`, `GameBlock.tsx` | Load the native document and adapt the legacy block state. |
| `games.tsx` | Production wiring for `GamesContext`: user, leaderboards, results, status. |
| `games-hub.tsx`, `route.tsx`, `games-access.ts` | The `/app/games` route and the rollout flag. |
| `room-status-badge.tsx` | Read-only status badges for lists, previews and mentions. |
| `core/` | Catalog, log vocabulary, game rules and replay. Pure and framework-free. |
| `context/` | The room source and games capability contracts. |
| `queries/` | Loro session, API calls, leaderboard query, status publishing. |
| `primitives/` | Room state, turn matches, races, solo and arcade runs, Pong, frame loop, held keys, reporting. |
| `components/` | Boards, seats, leaderboard rows, cards. |
| `views/` | The hub, each room, and the team leaderboard panel. |
| `tests/` | An in-memory room source and a recording games context. |

## Adding a game

1. Add the kind to `GAME_KINDS` and `GAME_CATALOG` in `core/catalog.ts`, and to
   `GameKind` plus the `game_kind` enum in `crates/games` (new migration). Give
   score-ranked games a server-side bound in `GameKind::score_range`.
2. Turn-based games implement `TurnRules` (`core/turn-match.ts`); the shared
   `TurnRoom` view provides seats, turns, rematches and reporting (Pong reuses
   it with the first seat as the only one that "moves"). Solo games record a
   `run` entry and reuse `views/solo-room-shell.tsx`; real-time ones step a pure
   engine from `createFrameLoop`.
3. Add a board component and a room view, register it in
   `views/game-room-view.tsx`, and cover the rules with core tests.

## Verifying

```sh
cd apps/web && bunx vitest run src/features/block-game
cargo test -p games --all-features   # from the repository root, with a database
```

The view tests drive real rooms over an in-memory Loro document. To play two
clients side by side in a browser without a backend, mount `GameRoomView` for
two users over two `LoroDoc`s relayed with `subscribeLocalUpdates`.
