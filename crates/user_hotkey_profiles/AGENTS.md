# user_hotkey_profiles

## What it is

Part of the keyboard shortcuts setting. Stores the shortcut layout each person
picks per area of the app (Superhuman's keys in Email, Linear's in Tasks) so
the choice follows them across devices, and serves `GET`/`PUT
/user/hotkey-profiles` from `services/authentication_service`. The backend
stores only the choice; the bindings themselves live in the web app.

## Start here

- `src/domain/models.rs`: the layouts per area and `UserHotkeyProfiles`, the
  wire shape of both routes.
- `src/inbound/axum_router.rs`: the two routes, mounted under `/user`.
- `src/outbound/pg_user_hotkey_profiles_repo.rs`: the `user_hotkey_profiles`
  table.

## Scope

- Owns: the `user_hotkey_profiles` table. A missing row, or a `NULL` column,
  is Macro's own shortcuts.
- Not here: the bindings and how a layout is applied → `apps/web` (hotkeys).

## Recipes

- Add a layout to an area: a variant on that area's enum in
  `src/domain/models.rs` (no migration; columns are text) → regenerate the web
  and SDK clients → the web hotkey layout.
- Add an area: a column via `sqlx migrate add` → a field on
  `UserHotkeyProfiles` and an enum → both queries in the repo →
  `nix develop --command just prepare_db` → regenerate the clients.

## Checks

- `cargo test -p user_hotkey_profiles --all-features` (`SQLX_OFFLINE` unset;
  requires local MacroDB).

## Gotchas

- A stored layout this build doesn't know fails the read (500), so removing a
  variant needs a migration that clears it first, and rolling back past a
  release that added one breaks the read for users who picked it.
- `PUT` replaces every area at once; clients send the whole object.
