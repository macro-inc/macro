# contacts_outbound

## What it is

Part of Contacts: the adapters behind `contacts_core`'s ports. The Postgres
repository, the SQS ingress queue, and the connection gateway notifier that
announces graph changes.

## Start here

- `src/repository.rs`: Postgres adapter.
- `src/repository/page.rs`: indexed paging of both graph directions and self, plus exact lookups through `lookup.sql`. Match peers with `lower(... COLLATE "C")` and the strict `macro|` prefix predicate using the two scoped expression indexes; keep raw viewer equality and raw page cursors unchanged. Membership is bounded per input key before names; preserve the LATERAL limit and both custom/generic 100k-row plan regressions. Deploy migrations `20261105044718` and `20261105044750` before the lookup query.
- `src/repository/people_search.sql` (`GET /contacts/search`, `PeopleSearchService`, models in `contacts_core` `src/models/people.rs`): one ranked query over the viewer's edges, self, and current team (`team_user`); teammates first, then name/email prefix, then byte-ordered name/email. Matches email and Macro profile names only (address-book labels name results but are not searched). Trimmed queries under 2 chars read nothing; limit default 20, capped at 50; 5 s statement timeout. Cost is ~6 index probes per candidate ("User" + `macro_user_info`): ~94k buffer hits / ~100 ms for 15k contacts. Keep candidate ids in the default collation or the joins lose their indexes.
- `src/names.rs`: `directory-names` feature, reusing the existing user-name owner's profile-over-address-book query without duplicating SQL.
- `src/gateway.rs`: connection gateway notifier.
- `src/ingress.rs`: SQS-backed ingress queue.

## Boundaries

- Depends on: `contacts_core`.
- Used by: the composition roots and `agent_tools`, through the `contacts`
  facade.

## Recipes

- Add a repository query: `src/repository.rs` → its `test.rs`.

## Checks

- `cargo test -p contacts_outbound --all-features -- --test-threads=2` (`SQLX_OFFLINE` unset; `directory-names` covers name precedence and account isolation; needs a local
  MacroDB — see `.agents/rules/rust/guardrails.md`).
