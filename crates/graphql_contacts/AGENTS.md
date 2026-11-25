# graphql_contacts

## What it is

The GraphQL inbound adapter for the viewer's personal contact directory. It exposes
bounded, enriched pages under `GraphqlUser`; these are not CRM contacts.

## Start here

- `src/user_query.rs`: contact objects, validated page arguments, and opaque cursors.
- `src/reads.rs`: request-data composition over the contacts domain ports (`ContactDirectory`, `PeopleNamingService`).
- `src/test.rs`: bounds, continuation, error, and authenticated-viewer contracts.

## Scope

- Owns: GraphQL shapes, argument/cursor conversion, and transport error codes.
- Not here: graph membership, name enrichment, or database queries → `crates/contacts`.

## Boundaries

- Depends on: the `contacts` domain read ports, `macro_user_id`, and `models_pagination`.
- Used by: `complete_graph` and the DSS composition root.

## Checks

- `cargo test -p graphql_contacts`
- `cargo test -p complete_graph --lib contacts`
- Regenerate `static_assets/schema.graphql` and web GraphQL types after shape changes;
  see `docs/guides/add-graphql-field.md` at the repository root.

## Gotchas

- Construct the query only from the authenticated root viewer, never a user argument.
- `GraphqlContact.lists` is the viewer's list keys for the person (`teammates`, `interacted`, `invited`, `gmail`, `outlook`; clients treat keys as opaque). It resolves from the list-aware tables for every viewer, whichever store the `contacts-list-reads` flag chose the ids from, so it is empty for self and for a person only the legacy graph knows.
- `GraphqlContact.id` identifies the viewer/person pair; `userId` identifies the target.
  Viewer-specific names must not merge into public user profiles or `GraphqlUser`.
- Only a null continuation proves exhaustion. Search budget exhaustion or invalid legacy IDs can leave empty pages. Reset cursors for a new query; server search returns ID-ordered pages, not ranked top-K results.
- `contactsByUserIds` takes target user IDs, not viewer-scoped record IDs; `contactsByEmails` uses the same membership checks. Both cap raw input at 500, preserve first-requested order, and return nothing for empty input.
- `contacts(matching: EXACT | FIRST_NAME | ANY_NAME)` selects a domain-owned reference predicate before limiting and requires nonempty `search`. Omission preserves subsequence search. These modes keep the four-batch work budget and may return empty continuation pages; ship the additive schema before clients select `matching`.
- `contactsNamedBy(search, limit)` is the ranked whole-directory read of the people the text names (`PeopleNamingService`): exact names and word starts by the local ranking's rule, ranked by list group, at most 50, no continuation. An address or user ID names nobody; text over 512 bytes or 32 words, or a limit under 1, is `BAD_USER_INPUT`. The web reads it behind `enable-named-contact-search` until DSS ships it.
- No query strings, cursor contents, names, or email-based user IDs belong in tracing fields.
