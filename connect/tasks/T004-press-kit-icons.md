# T004: Press-kit icons for the apps Simple Icons lacks

## Goal

Every live app has an `icon.svg`. Nine have none because Simple Icons 16.36.0
lacks their mark: Apollo, Attio, Canva, Granola, Klaviyo, monday.com,
Pipedrive, Quo, Slack.

## Context

- `connect/docs/catalog.md` (`icon.svg`: square, single file, under 10 KB,
  the vendor's mark unaltered; Simple Icons first, otherwise the vendor's press
  kit).
- `connect/crates/connect_registry/src/lib.rs` (`NO_SIMPLE_ICONS_ICON`) and
  `src/embedded.rs`.

## Do

1. For each of the nine apps, find the vendor's official brand assets (press
   kit, brand or media page on the vendor's own domain) and take its SVG mark
   (the symbol, not the full wordmark, where the kit offers both).
2. Save it unaltered as `connect/registry/apps/<id>/icon.svg` when it is a
   single SVG file under 10 KB. A mark that isn't square: keep it unaltered and
   note it in the Result. No SVG available, or only raster: add nothing and
   say so in the Result. Never draw, trace, or convert a mark.
3. Embed each new icon in `embedded.rs`, remove it from the allowlist, and
   rename the allowlist so it no longer names Simple Icons (it now means "no
   official SVG found").
4. List each icon's source URL in the Result and in the commit body.

## Done when

- `cargo nextest run --all-features -p connect_registry` passes.
- `just check` passes.

## Out of scope

Any other app, any other field, docs.

## Result

Added unaltered SVGs to `connect/registry/apps/{attio,canva,granola,quo,slack}/icon.svg`, embedded them in `connect/crates/connect_registry/src/embedded.rs`, and reduced and renamed the missing-icon allowlist in `src/lib.rs` and `src/test.rs`. Attio's official logomark is 37 × 30, so it is not square; its proportions were preserved.

| App | SVG source |
| --- | --- |
| Attio | https://attio.com/brand/v1/attio-logomark.svg |
| Canva | `Canva logos/svg/Canva Icon logo.svg` in https://www.canva.dev/assets/connect/Canva-logos.zip |
| Granola | https://drive.google.com/uc?export=download&id=1OWPkmXSl0kpUCbLpJ3uIaTKIfFuvbK-L (current mark in [Granola's press kit](https://granola-labs.notion.site/Granola-Press-Kit-e8d9449f7768448dabddb473b320deba); [vendor brand announcement](https://jobs.granola.so/blog/a-new-look-for-granola)) |
| Quo | https://api.air.inc/shorturl/btHP3lps1/download/e69f42db-1184-4b10-b9f1-32ef51ed831b (linked from https://www.quo.com/press) |
| Slack | https://a.slack-edge.com/1f40066/marketing/img/nav/logo.svg (served on https://slack.com/media-kit) |

No icon added for Apollo (no downloadable SVG in its newsroom), Klaviyo (newsroom mark is PNG), monday.com (official press-kit logo ZIP contains PNGs only), or Pipedrive (its press-kit logo files require an access request).

| Check | Outcome |
| --- | --- |
| `cargo nextest run --all-features -p connect_registry` | Passed: 7 tests, 0 skipped, in `nix develop` with the Connect Cargo target and database variables exported. |
| `just check` | Passed: `OK` (cargo fmt and ast-grep), in `nix develop`; required writable `/tmp` runtime directory and patching the temporary ast-grep binary's interpreter for NixOS. |
| `cargo x deps --check` | Passed in audit. |
| `cargo fmt --all -- --check` | Passed in audit. |
| `just clippy` | Passed in audit. |
| Fresh source comparison | Passed: all five saved SVGs matched their source bytes. |
| `git diff --check` | Passed. |

Implementation and Result commits are blocked: the shared Git directory `/home/eric/Code/macro/.git/worktrees/T004-press-kit-icons` is read-only, so `git add` cannot create `index.lock`. `PREK_ALLOW_NO_CONFIG=1 git commit -F /tmp/t004-implementation-commit.txt` failed for the same reason. No commits were created.

Open question: how should the planner commit this work when the shared Git directory is read-only? `connect/crates/connect_registry/AGENTS.md` still describes the old Simple Icons allowlist because this task excludes docs.
