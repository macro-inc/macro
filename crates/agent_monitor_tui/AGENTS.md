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
  spend). Spend by kind is the collector's split of today (`Totals::spend_by_kind`),
  never a sum of rows' lifetime costs, so it adds up to the day total.
- `src/ui.rs`: layout and its width breakpoints; panes and pages live in `src/ui/`.
- `src/body.rs`: the `BodyPane` trait behind 7 BODY, and the `Vitals` placeholder.

## Scope

- Owns: view state, the key machine, panes, pages, drill-in, the run loop.
- Not here: the model, store, demo fleet and gRPC client → `crates/agent_monitor`;
  the `macrod monitor` subcommand → `crates/coding_agent_worker`.

## Recipes

- Add a pane: a `keys::Pane` variant (and `Page::panes` order) → `ui/panes.rs`
  → its slot in `ui::draw_monitor`.
- Add a command mnemonic: `keys::Command::parse` → `HELP` in `ui.rs` → a key test.
- Swap the BODY figure: implement `body::BodyPane` and pass it to `ViewState::new`.

## Checks

- `cargo nextest run --all-features -p agent_monitor_tui`
- Screen changes: review and accept `src/ui/snapshots/` with `cargo insta review`.
- Look at it live: `cargo run -p agent_monitor_tui --example demo` (in tmux at
  200x56 for a recording; `tmux capture-pane -e -p` for a text screenshot).

## Gotchas

- Snapshot tests use `agent_monitor::outbound::demo::snapshot` at a fixed clock
  and UTC offset; never render with the system clock in a test.
- Blinking follows the clock's sub-second phase, so a frame at a whole second
  is the "on" phase.
- Keep the key machine pure: no I/O or view state in `keys.rs`; page-specific
  meaning (what Enter opens) is decided in `app.rs`.
- Unix only beyond the pure modules: `feed`, `runner` and `run` are `cfg(unix)`
  because the client is.

## Related

- Rules: `.agents/rules/rust/code.md`
