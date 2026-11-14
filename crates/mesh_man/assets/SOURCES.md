# Asset figure sources

Each `.mmf` file here is line data that `../convert` derived from a
downloaded 3D model: contour rings sliced from the mesh, a skeleton from its
bones or joints, and nerves routed along the joints. No mesh, texture or
animation data from the source is stored. Raw downloads live in the
git-ignored `../assets-raw/` and are never committed.

Run each command from `crates/mesh_man/convert` (see `../convert/README.md`).
The licences below are quoted as each source states them, as of 2026-11-14.

## anatomical.mmf (ANATOMICAL)

- Source: BodyParts3D, "part of" tree, version 4.0, OBJ, 99% reduced:
  <https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip>
  with its lists `partof_element_parts.txt`, `partof_parts_list_e.txt` and
  `partof_inclusion_relation_list.txt` from the same directory (download
  page: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>).
- Licence: Creative Commons Attribution 4.0 International
  (<https://creativecommons.org/licenses/by/4.0/>), per
  <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>. Required
  attribution: "BodyParts3D, © The Database Center for Life Science licensed
  under CC Attribution 4.0 International". Earlier releases of the database
  were licensed CC BY-SA 2.1 Japan; the licence page now states CC BY 4.0.
- Converted with:
  `cargo run --release -- anatomical ../assets-raw/bp3d ../assets/anatomical.mmf`
  (skin, bones, brain and heart picked by FMA concept and part name; joints
  from bone ends).

## rigged.mmf (RIGGED)

- Source: three.js example model `Xbot.glb`:
  <https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb>
- Licence: no licence or readme accompanies the file in
  `examples/models/gltf`. The three.js example that loads it
  (`examples/webgl_animation_skinning_additive_blending.html`) credits it
  "model from mixamo.com". The three.js repository itself is MIT licensed
  (`LICENSE`); Mixamo characters are covered by Adobe's Mixamo terms.
- Converted with:
  `cargo run --release -- rigged ../assets-raw/Xbot.glb ../assets/rigged.mmf --animation idle --time 1.0`

## soldier.mmf (SOLDIER)

- Source: three.js example model `Soldier.glb`:
  <https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb>
- Licence: no licence or readme accompanies the file. The three.js examples
  that load it credit it "model from mixamo.com"
  (`webgl_animation_skinning_blending.html`, `webgl_animation_walk.html`)
  and "Soldier model from https://www.mixamo.com"
  (`webgl_animation_multiple.html`). Mixamo terms apply as for RIGGED.
- Converted with:
  `cargo run --release -- rigged ../assets-raw/Soldier.glb ../assets/soldier.mmf --name SOLDIER --animation Idle --time 0.5`

## dancer.mmf (DANCER)

- Source: three.js example model `Michelle.glb`:
  <https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Michelle.glb>
- Licence: no licence or readme accompanies the file. The three.js examples
  that load it (`webgpu_skinning.html`, `webgl_tsl_skinning.html`) describe
  it as "a model from Mixamo". Mixamo terms apply as for RIGGED.
- Converted with:
  `cargo run --release -- rigged ../assets-raw/Michelle.glb ../assets/dancer.mmf --name DANCER --animation SambaDance --time 3.5`
