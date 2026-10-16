# convert_service

## What it is

Documents feature: converts uploaded Office documents (docx/xlsx/legacy
Office formats) into Macro documents using LibreOfficeKit, triggered
synchronously via HTTP or asynchronously via SQS.

## Start here

- `src/process/convert.rs` + `src/process/runner.rs`: the LibreOfficeKit
  conversion pipeline and the SQS-driven worker loop.
- `src/api/convert.rs`: the synchronous HTTP conversion endpoint.
- `src/api/backfill.rs` + `helpers/backfill.ts`: backfilling existing documents
  through conversion (bun script, hits the deployed gateway endpoint).
- `src/main.rs`: `smoke_test_lok` — forks a child process at startup to verify
  LibreOfficeKit's shared libraries load before accepting traffic.

## Scope

- Owns: office-document-to-Macro conversion and its worker/backfill paths.

## Recipes

- Change conversion behavior: `src/process/convert.rs` → `src/process/test.rs`.
- Backfill existing documents: `helpers/backfill.ts` (`bun backfill`, needs
  `BASE_URL`/`INTERNAL_API_KEY`/`LIMIT`/`OFFSET` — see `helpers/README.md`).
- Load-test: `load-test/artillery.yml` (`artillery run artillery.yml`).

## Checks

- `cargo test -p convert_service` (`SQLX_OFFLINE` unset).

## Gotchas

- Startup fails fast if LibreOfficeKit can't load (`smoke_test_lok`); a
  conversion regression that looks like a code bug may actually be a missing
  LOK shared library in the environment.
- The `disable_cleanup`/`disable_worker`/`local_queue` Cargo features gate
  local-dev behavior — don't assume they're enabled in deployed builds.

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
