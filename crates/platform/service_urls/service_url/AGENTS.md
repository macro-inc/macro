# service_url

## What it is

Shared infrastructure: the `service_url!` macro, the `ServiceUrl` string value
and the `OVERRIDE_<NAME>` reader behind every typed Macro service URL. The URLs
themselves are the sibling crates in `crates/platform/service_urls/`.

## Scope

- Owns: the macro, override-env resolution, `ServiceUrlVarErr`.
- Not here: URL values → one sibling crate per URL; the all-in-one re-export
  and `ServiceUrls` collection → `crates/platform/macro_service_urls`.

## Checks

- `cargo test -p macro_service_urls` (its tests cover this crate's macro).

## Gotchas

- The `testing` feature swaps in a thread-local override mock; enable it only
  from dev-dependencies.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Group: `../AGENTS.md`
