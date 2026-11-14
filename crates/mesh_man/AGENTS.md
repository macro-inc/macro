# mesh_man

## What it is

A slowly turning wireframe human for terminal dashboards: skin mesh, skeleton
and nervous system drawn in braille on a ratatui `Canvas`. Callers fire pulses
along nerves to show activity. It has no dependency on any monitor; the agent
monitor is meant to drive it.

## How it works

A `Figure` (`src/figure.rs`) is a named set of line layers (skin, bone,
extra), brain lines, drawn-only nerve lines, pulse nerve paths and an optional
`Core` (heart or reactor), all in the shared figure units. `catalog()` lists
the built-in figures; the first, `model::mesh_man` (authored in code), is the
default. `Body` holds a list of figures and cycles them (`next_figure`,
`prev_figure`, `select_figure`, `figure_name`). Each frame `Body` rotates
every vertex (`project::View`), projects it in perspective, and paints canvas
layers far to near. A braille cell has one colour and a later layer replaces
the cell, so layer order is the depth cue.

## Start here

- `src/lib.rs`: the public API (`Body::fire`, `set_load`, `tick`, `nerve_names`, `nerve_for`, `heart_rate`).
- `src/widget.rs`: layers, palette, pulses and flashes on screen.
- `src/figure.rs`: `Figure`, its builder (`build_normalised` for figures in
  other units) and `catalog()`.
- `src/model.rs`: the default figure's joints, skin rings, bones, nerve paths.
- `src/figures.rs` and `src/figures/`: the procedural figures after it (XRAY,
  CYBORG, NEURAL), drafted in `common.rs` helpers (joints, branching nerve
  trees, a seeded random source) and turned into `Figure`s by `finish`.
- `src/palette.rs`: each figure's `Look` and its colours.

## Recipes

- Add a figure: build it with `Figure::builder` and add it to `catalog()`;
  the catalog test checks every figure fits the unit cube. Give it a `Look`
  (or add one in `src/palette.rs`); `fork_group` makes nerves fire together
  so pulses fork, and `quiet_paths` stops pulse paths drawing at rest when
  nerve lines already trace them.
- Preview a figure as frames: `cargo run --release -p mesh_man --example
  frames -- XRAY 50 36 4 3750 > x.cast`, then `agg` (nixpkgs
  `asciinema-agg`) to a GIF; it prints the worst render time.
- Add a nerve: `side_nerves` (or `mesh_man`) in `src/model.rs`; it must
  start at `BRAIN` and stay inside the unit cube (tests check both). Update the
  name list in `Body::nerve_names`' doc. A new nerve moves every hashed key (`Body::nerve_for`).
- Change the look: `src/widget.rs` constants and layer order, then refresh the
  snapshots (`INSTA_UPDATE=always`) and check them in a real terminal.

## Checks

- `cargo nextest run --all-features -p mesh_man`
- `cargo run -p mesh_man --example spin` in a real terminal (`q` quits): one turn
  per 30 s, bones inside the skin, pulses running brain to hand and back.

## Gotchas

- The figure's coordinates: 2.0 tall, feet at `y = -1`, `+x` its left, `+z` the
  way it faces. Every point must lie in `[-1, 1]^3`.
- Near/far uses the turn only, not the tilt (`View::depth`); with the tilt the
  front of the shins would count as far.
- Snapshot text depends on `f32` trig; a change to any constant moves dots.
