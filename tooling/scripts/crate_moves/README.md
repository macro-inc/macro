# crate_moves

Scripts behind the crate reorganization, which groups `crates/` one level
deep by feature (`crates/<group>/<crate>`). They are kept in the repo so
branches opened before a move can fix their paths afterwards.

| Script | Does |
| --- | --- |
| `move_crates.py maps/<n>.txt` | `git mv`s each `old new` pair and rewrites supported resource paths pointing at the old location: root `members` and `[workspace.dependencies]`, relative paths in manifests, `include_str!`, sqlx `migrations =`, CI, nix, `just` and docs. Recorded test data (fixtures, snapshots) is not touched. |
| `move_crates.py --rewrite-only maps/<n>.txt` | Only the rewrite, for a branch that merged a move and still has old paths. |
| `rename_packages.py old=new …` | Renames packages: dependency keys, `-p` flags, hakari lists, docs; preserves recorded data, migrations and tool provenance. |
| `rename_crate.py [--words] old new` | Renames a crate: directory, package, lib name, every `use`, manifest key, feature, `-p` flag and package list. `--words` also renames whole-word mentions in docs and comments for distinctive names. |
| `validate_paths.py` | Reports paths into `crates/` that no longer resolve: `include_str!`, sqlx `migrations =`/fixtures, `CARGO_MANIFEST_DIR` joins, justfile paths and root-relative `crates/...` strings. |
| `dedupe_layers.py` | Drops explicit crate paths from `.config/layers.toml` once a group glob covers them. |
| `group_agents.py <group> <layer> "<desc>"` | Writes `crates/<group>/AGENTS.md` listing the group's crates. |

`maps/` holds one map per move PR, in merge order.

## Path rewrite boundaries


Rust rewrites require a resource use context: `include!`, `include_str!`,
`include_bytes!` (also qualified with `std::`), `insta::glob!`'s directory,
`#[path = "..."]`, and SQLx test fixtures, migrations and `sqlx::migrate!`.
Fixtures and includes resolve against the source file; migrations resolve
against its Cargo manifest. Manifest paths also support
`concat!(env!("CARGO_MANIFEST_DIR"), "/../...")`, direct `Path`/`PathBuf`
manifest joins, and immutable manifest bindings in the same lexical block.
The scan follows simple immutable aliases; it does not infer provenance
through scopes, mutable bindings, dynamic expressions or escaped strings.
Inspect those resource uses and repair them explicitly when moving them.

A string's appearance never establishes a Rust resource use. Validation
inputs such as `".."` and `"../task"`, raw/byte strings, comments and unrelated
call arguments retain their contents. Markdown rewrites only link and
reference destinations outside code. Inline/fenced examples and command
arguments retain their contents because their runtime directory can differ
from the document's directory. Update moved file references in prose and
commands with their actual base in mind; prefer Markdown links for document
references that should move automatically. Shell heredoc bodies also retain
their exact contents; structural paths outside those bodies still rewrite.
Files with no potential parent-relative, manifest-leading-slash, justfile or
mapped root path match need no resource interpretation and remain unchanged.
When a potential rewrite is present, a heredoc inside a quoted command
substitution is rejected before any source rewrite or move; inspect and handle that resource explicitly rather than
letting the lexical scan guess at nested executable syntax.
Other structural config, manifest,
CI, Nix and justfile path rewriting keeps its existing behavior.

Both the mover and package renamer preserve recorded fixture/snapshot/testdata/
golden inputs, `.snap`, `.sse`, `.jsonl`, `.har`, and applied migrations byte
for byte. The crate-move tool implementation, maps and regression sources are
also excluded so executing a rename cannot rewrite its own historical inputs.
Ordinary package source/tests remain eligible for structural package renames.
Existing generated commits are not repaired by installing a corrected
script: regenerate their owning step and verify exact original blobs.

Run independent regressions: `python3 -B -m unittest discover -s
tooling/scripts/crate_moves -p test_move_crates.py`.

## Updating an open branch after a move lands

```sh
git merge origin/main                 # accept git's suggested location for files added in moved crates
git add -A
python3 tooling/scripts/crate_moves/move_crates.py --rewrite-only tooling/scripts/crate_moves/maps/<n>.txt
cargo x deps
```

Run every map that landed since your branch's merge base, in order.

`maps/22-renames.txt` lists the crate renames: the old and new directory,
whose last components are the old and new package names. `--rewrite-only`
fixes paths; dependency keys and `use` paths need the package rename too.
For each pair, rename `old = { workspace = true }` keys and `old::` paths:

```sh
grep -v '^#' tooling/scripts/crate_moves/maps/22-renames.txt | while read -r old new; do
  o=${old##*/} n=${new##*/}
  git ls-files -z '*Cargo.toml' '*.rs' | xargs -0 sed -i -E \
    -e "s/^${o}( *= *\{|\.workspace)/${n}\1/" -e "s/\"(dep:)?${o}(\??\/)/\"\1${n}\2/g" \
    -e "s/(^|[^[:alnum:]_:.])${o}::/\1${n}::/g" -e "s/^(\s*(pub )?use )${o}\b/\1${n}/"
done
cargo x deps && cargo check --workspace
```

Short names (`agent`, `model`, `chat`, `prompt`, `cal`, `initiative`,
`projects`) also match local modules; let `cargo check` point at any it
rewrote wrongly.
