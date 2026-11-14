# mesh_man

## What it is

A slowly turning wireframe human for terminal dashboards: skin mesh, skeleton
and nervous system drawn in braille on a ratatui `Canvas`. Callers fire pulses
along nerves to show activity. It has no dependency on any monitor; the agent
monitor is meant to drive it.

## How it works

`Model::build` authors the figure in code (no asset). Each frame `Body` rotates
every vertex (`project::View`), projects it in perspective, and paints canvas
layers far to near. A braille cell has one colour and a later layer replaces
the cell, so layer order is the depth cue.

## Start here

- `src/lib.rs`: the public API (`Body::fire`, `set_load`, `tick`, `nerve_names`).
- `src/widget.rs`: layers, palette, pulses and flashes on screen.
- `src/model.rs`: joints, skin rings, bones, nerve paths.

## Recipes

- Add a nerve: `side_nerves` (or `Model::build`) in `src/model.rs`; it must
  start at `BRAIN` and stay inside the unit cube (tests check both). Update the
  name list in `Body::nerve_names`' doc.
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
