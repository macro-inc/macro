# agent_monitor_tui

## What it is

The agent monitor's terminal viewer (`macrod monitor`): a dense,
Bloomberg-style board of every agent on the machine, drawn with ratatui from
the collector in `crates/agent_monitor` or from an in-process demo fleet.

## How it works

`run(Options)` builds a `feed::Feed` (the socket via `agent_monitor::client::watch`,
or `feed::demo` running the demo source through a real `Store`), then
`runner::run_loop` selects over terminal input (a reader thread), the update
stream, the open agent's transcript and a frame timer. `ViewState::apply`
mirrors updates and sets `dirty`; the loop draws only when dirty, at most 30
times a second, and ticks at `fps` only while something animates.

## Start here

- `src/keys.rs`: the pure key machine `step(mode, key, page) -> (mode, Action)`.
- `src/app.rs`: page stack, cursors, filters; how each `Action` lands.
- `src/view.rs`: the mirrored state and the derived rows (sorting, failures,
  spend, PRs: failing CI first). Spend by kind is the collector's split of
  today (`Totals::spend_by_kind`), never a sum of rows' lifetime costs, so it adds up to the day total.
- `src/ui.rs`: bottom key hints and width breakpoints; panes and
  pages live in `src/ui/`. The global header, navigation strip, and quote board are removed.
  `ui/agent_summary.rs` draws separate status and activity rows inside AGENTS,
  both in the monitor and on its full page. Spend lives in SPEND (the full
  page also lists lifetime cost by agent), and error counts live in FAILURES.
  8 CHANGES (`ui/changes.rs`) shares the lower right with FAILURES; agent
  rows carry a PR badge and the drill-in lists the agent's PRs (`pr_line`).
- `src/ui/changes/`: the CHANGES page. `layout.rs` is pure (time buckets to
  columns, lanes to rows in fork order, fork lines, arcs packed above the
  trunk) and returns a `Scene` the unit tests check; `draw.rs` paints it
  with tokens (map, board, inspector); `compact.rs` is the list for the
  monitor grid and widths under 100; `lane.rs` is a lane's page (`p`). Lane
  order, attention and orphan PRs are `view.rs` (`sorted_lanes`,
  `fork_order`, `attention`, `orphan_prs`); its cursor (`ChangesCursor`,
  kept by branch and commit id) and keys (`Action::Changes`) are in
  `app.rs`.
- `src/body.rs`: the `BodyPane` trait behind 7 BODY, and the `Vitals` placeholder.
- `src/theme.rs`: the design tokens (`Token`, a colour role such as `Alert`
  or `Rule`), the `Theme` that colours them, and the HUD dressing: thin
  frames, orange title chips, segmented meters, the dot grid and the glitch
  on fresh errors. The themes (`ThemeName`: classic, ember, phosphor, dusk)
  are in `src/theme/themes.rs`; Ctrl-T, a backtick (for terminals in a
  browser, which keeps Ctrl-T) or the `THEME [name]` command line
  switches them, `[monitor] theme` and `--theme` pick the first (names in any
  case).

## Scope

- Owns: view state, the key machine, panes, pages, drill-in, the run loop.
- Not here: the model, store, demo fleet and gRPC client → `crates/agent_monitor`;
  the `macrod monitor` subcommand → `crates/coding_agent_worker`.

## Recipes

- Add a pane: a `keys::Pane` variant (and `Page::panes` order) → `ui/panes.rs`
  → its slot in `ui::draw_monitor`.
- Add a command mnemonic: `keys::Command::parse` → `HELP` in `ui.rs` → a key test.
- Add a theme: a `ThemeName` variant and its `Spec` in `src/theme/themes.rs`
  (keep `text`, `accent` and `bg`: the amber ink is the product's look; keep
  `Ok` and `Info` calm, and `Highlight` near the ink, so `Alert` and
  `Attention` draw the eye) → the theme
  list in `config.rs`, `config.example.toml` and the README of
  `crates/coding_agent_worker`. Look at it with
  `cargo run -p agent_monitor_tui --example demo -- --theme <name>`.
- Swap the BODY figure: implement `body::BodyPane` and pass it to `ViewState::new`.

## Checks

- `cargo nextest run --all-features -p agent_monitor_tui`
- Screen changes: review and accept `src/ui/snapshots/` with `cargo insta review`.
- Look at it live: `cargo run -p agent_monitor_tui --example demo` (in tmux at
  200x56 for a recording; `tmux capture-pane -e -p` for a text screenshot).

## Gotchas

- Snapshot tests use `agent_monitor::outbound::demo::snapshot` at a fixed clock
  and UTC offset; never render with the system clock in a test. CHANGES has
  `changes_240x45`, `changes_200x56`, `changes_narrow_100x30`,
  `changes_compact_80x24`, a failing lane selected, `lane_detail_200x56`,
  no repositories with PRs, and a PR in an unmapped repository.
- CHANGES colours lanes by state (working `Ok`, failing CI `Alert`, CI
  running `Highlight`, idle `TextDim`), never by agent; identity is the
  board's tag. The map's now is quantised to its bucket, so it moves one
  column when a bucket ends, and commits glitch only when a delta brings
  them (`ViewState::fresh`), never after a snapshot.
- On the CHANGES page `+ - < > [ ] n N m s p` and Home are page keys
  (`keys::ChangeKey`), so there a command starting with m, s, p or n is
  typed in capitals (`MON`, `SPND`, `SRC`, `PRS`; no mnemonic starts with
  N); on the monitor and BODY pages `b` is a page key too, so BODY is typed
  in capitals there; elsewhere letters start the command line in any case. Its tabs are
  the mapped repositories, then `other PRs` (`app::ChangeTab::OtherPrs`)
  for pull requests in no mapped repository, drawn as PRS rows.
- Blinking follows the clock's sub-second phase, so a frame at a whole second
  is the "on" phase.
- `b` cycles the BODY figure forward on the monitor page and the BODY page;
  `B` cycles back only on the BODY page, so on the monitor page a capital
  `B` starts the command line and `BODY` still types. Elsewhere `b` starts
  the command line.
  Every figure follows the theme: `Theme::figure` is the mesh man's
  `Palette`, and each figure's `Look` maps its parts onto those roles, so a
  theme change (backtick, Ctrl-T or `THEME`) recolours whichever figure is
  showing.
- Keep the key machine pure: no I/O or view state in `keys.rs`; page-specific
  meaning (what Enter opens) is decided in `app.rs`.
- A bare letter starts the command line, so never bind a lowercase letter
  that begins a mnemonic (`t` would swallow TAPE and TREE). The
  exceptions are CHANGES (`m s p n`) and `b` on the monitor and BODY pages; they leave
  capitals for commands (above).
  Elsewhere use Ctrl or a command instead, as the theme does (Ctrl-T, `` ` ``, `THEME`). Browsers
  (ttyd previews) swallow Ctrl-T, Ctrl-W and Ctrl-N, so give every Ctrl key
  a plain-key twin.
- Name colours only as `theme::Token`s (`theme::ink(Token::Info)`); never
  write a `Color` outside the theme definitions in `src/theme/themes.rs`.
  `theme::active()` is thread-local and `ui::draw` sets it from `App::theme`
  each frame, so render through `ui::draw` (or call `theme::set_active`). Pick the token
  by role, not by the hue you want: see the doc on each `Token` variant.
- Put only the title in a pane's chip; render hotkeys in square brackets,
  right-aligned outside the chip with `theme::hotkeys` (help stays in the bottom bar).
- Use thin outlines for every pane through `theme::pane` or `theme::frame`;
  `ui::draw` finishes each frame with `theme::grid` (dots on blank pane rows).
- The glitch follows the frame clock, so it moves only while frames are drawn
  and settles after `theme::GLITCH_MS`; snapshots at the fixed clock are stable.
- Unix only beyond the pure modules: `feed`, `runner` and `run` are `cfg(unix)`
  because the client is.

## Related

- Rules: `.agents/rules/rust/code.md`
