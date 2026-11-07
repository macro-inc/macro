# crate_moves

Scripts behind the crate reorganization, which groups `crates/` one level
deep by feature (`crates/<group>/<crate>`). They are kept in the repo so
branches opened before a move can fix their paths afterwards.

| Script | Does |
| --- | --- |
| `move_crates.py maps/<n>.txt` | `git mv`s each `old new` pair and rewrites every path that pointed at the old location: root `members` and `[workspace.dependencies]`, relative paths in manifests, `include_str!`, sqlx `migrations =`, CI, nix, `just` and docs. Recorded test data (fixtures, snapshots) is not touched. |
| `move_crates.py --rewrite-only maps/<n>.txt` | Only the rewrite, for a branch that merged a move and still has old paths. |
| `rename_packages.py old=new …` | Renames packages: dependency keys, `-p` flags, hakari lists, docs. |
| `rename_crate.py [--words] old new` | Renames a crate: directory, package, lib name, every `use`, manifest key, feature, `-p` flag and package list. `--words` also renames whole-word mentions in docs and comments for distinctive names. |
| `validate_paths.py` | Reports paths into `crates/` that no longer resolve: `include_str!`, sqlx `migrations =`/fixtures, `CARGO_MANIFEST_DIR` joins, justfile paths and root-relative `crates/...` strings. |
| `dedupe_layers.py` | Drops explicit crate paths from `.config/layers.toml` once a group glob covers them. |
| `group_agents.py <group> <layer> "<desc>"` | Writes `crates/<group>/AGENTS.md` listing the group's crates. |

`maps/` holds one map per move PR, in merge order.

## Updating an open branch after a move lands

```sh
git merge origin/main                 # accept git's suggested location for files added in moved crates
git add -A
python3 tooling/scripts/crate_moves/move_crates.py --rewrite-only tooling/scripts/crate_moves/maps/<n>.txt
cargo x deps
```

Run every map that landed since your branch's merge base, in order.
