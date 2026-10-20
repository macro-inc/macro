# user_language

## What it is

Part of the interface language setting. Stores the language each person picks
for the app's interface (`"User".language`) and serves `GET`/`PUT
/user/language` from `services/authentication_service`. The team default lives
on `team.language` in `crates/teams`; the web app shows the person's language,
else the team's, else English.

## Start here

- `src/domain/service.rs`: `UserLanguageServiceImpl` — read and set.
- `src/inbound/axum_router.rs`: the two routes, mounted under `/user`.
- `model_user::Language`: the supported languages and their BCP 47 tags.

## Scope

- Owns: the `"User".language` column.
- Not here: the team default → `crates/teams` (`PatchTeamRequest.language`);
  translations and language resolution → `apps/web/src/lib/i18n`.

## Recipes

- Add a language: a `model_user::Language` variant → regenerate the web and SDK
  clients → `apps/web/src/lib/i18n/languages.ts` and a
  `locales/<tag>.ts` translation.

## Checks

- `cargo test -p user_language --all-features` (`SQLX_OFFLINE` unset; requires
  local MacroDB).
