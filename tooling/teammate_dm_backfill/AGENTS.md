# teammate_dm_backfill

## What it is

Operator binary (`backfill_teammate_dms`) that ensures every pair of
teammates has a DM, for teams whose membership events were missed. It pages
team rosters from `teams` and creates missing DMs through `channels`
(`ensure_dms_for_roster`). It lives here, not in either crate, so neither
domain depends on the other.

## Recipes

- Run it through the `crates/teams` recipes:
  `just crates/teams/backfill_teammate_dms_local` (or `_dev` / `_prod`, which
  confirm first).

## Gotchas

- Writing to dev or prod needs explicit permission (root `CLAUDE.md`).
