# graphql_contacts

## What it is

The GraphQL inbound adapter for the viewer's personal contact directory. It exposes
bounded, enriched pages under `GraphqlUser`; these are not CRM contacts.

## Start here

- `src/user_query.rs`: contact objects, validated page arguments, and opaque cursors.
- `src/reads.rs`: request-data composition over the contacts domain port.
- `src/test.rs`: bounds, continuation, error, and authenticated-viewer contracts.

## Scope

- Owns: GraphQL shapes, argument/cursor conversion, and transport error codes.
- Not here: graph membership, name enrichment, or database queries → `crates/contacts`.

## Boundaries

- Depends on: the `contacts` domain read port, `macro_user_id`, and `models_pagination`.
- Used by: `complete_graph` and the DSS composition root.

## Checks

- `cargo test -p graphql_contacts`
- `cargo test -p complete_graph --lib contacts`
- Regenerate `static_assets/schema.graphql` and web GraphQL types after shape changes;
  see `docs/guides/add-graphql-field.md` at the repository root.

## Gotchas

- Construct the query only from the authenticated root viewer, never a user argument.
- `GraphqlContact.id` identifies the viewer/person pair; `userId` identifies the target.
  Viewer-specific names must not merge into public user profiles or `GraphqlUser`.
- Only a null continuation proves exhaustion. Invalid legacy IDs can leave empty pages.
- No query strings, cursor contents, names, or email-based user IDs belong in tracing fields.
