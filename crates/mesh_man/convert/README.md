# mesh_man_convert

Turns downloaded 3D meshes into the mesh man's compact line figures, the
`.mmf` files in `../assets/` that `mesh_man`'s `src/assets.rs` decodes. It is
run by hand when an asset figure changes, never in CI or at build time.

It has its own `[workspace]` and lockfile and is listed in the root
`Cargo.toml`'s `exclude`, so its dependencies (`gltf`, `tobj`) stay out of the
product build and its checks.

## Use

1. Download the sources listed in `../assets/SOURCES.md` into
   `../assets-raw/` (git-ignored; never commit raw downloads). BodyParts3D:
   unzip `partof_BP3D_4.0_obj_99.zip` so the OBJ files sit in
   `assets-raw/bp3d/obj/`, next to the three `partof_*.txt` lists.
2. From this directory, run the command `SOURCES.md` gives for the file, for
   example:

   ```sh
   cargo run --release -- anatomical ../assets-raw/bp3d ../assets/anatomical.mmf
   cargo run --release -- rigged ../assets-raw/Xbot.glb ../assets/rigged.mmf --animation idle --time 1.0
   cargo run --release -- inspect ../assets-raw/Soldier.glb   # animations and joints
   ```

3. Check the figure: `cargo run -p mesh_man --example spin -- --figure NAME`
   from the repository root, and `cargo nextest run -p mesh_man` (every figure
   must fit the unit cube).

The same input converts to the same bytes.

## How it works

- `anatomical`: loads BodyParts3D's "part of" OBJ elements (millimetres),
  picks skin, bones, brain and heart by FMA concept and part name, and takes
  the joints from bone ends.
- `rigged`: poses a skinned glTF character at one animation frame and takes
  the joints from its skin.
- Both slice each mesh with evenly spaced planes into contour rings,
  simplify them, route the mesh man's named nerves along the joints, and
  write quantised `i16` polylines (`src/format.rs` documents the layout).
