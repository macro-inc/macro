# Adding an HTTP endpoint

A REST endpoint on an existing service touches the domain crate, its router, the
service's OpenAPI document, two generated clients, a hand-written web client, a
query module, and the SDK. Each section below is one place, in order. The misses
that needed follow-up fixes are called out inline.

Scope: an endpoint on a service that already serves HTTP and already has a web
client. For a new service, follow [new-service.md](new-service.md) §7 for the
client plumbing. For an AI or MCP tool, use the
[`create-ai-tool` skill](../../.agents/skills/create-ai-tool/SKILL.md).

## Pick a model to copy

| Building | Copy |
| --- | --- |
| Read one entity by id, access-checked | `get_github_pull_request_handler` in `crates/github_pull_requests/src/inbound/axum_router.rs` |
| A new router in a domain crate: scoped CRUD, path and body types, mounted in DSS | `crates/channel_labels/src/inbound/axum_router.rs` and its wiring in `services/document_storage_service/src/` |
| A compatible change to an existing endpoint (optional query param, new response field) | `services/notification_service/src/api/unsubscribe/unsubscribe_item.rs` |
| Web query module for it | `apps/web/src/lib/queries/channel-labels/` (`keys.ts` + query/mutation file) |

## 1. Domain service (required)

- Add the operation to the service trait in `crates/<domain>/src/domain/ports.rs`,
  implement it in `domain/service.rs`, and add any repository method to the
  outbound adapter. Follow the
  [hexagonal architecture skill](../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md):
  handlers run no SQL (CS-53), domain imports no transport (CS-51/52).
- Take the access receipt (`EntityAccessReceipt<ViewAccessLevel>` etc.) as the
  argument, not a raw id plus a user id, so the domain can't be called without the
  check. Report the caller's permission from that receipt; an initiative endpoint
  shipped returning a placeholder `userAccessLevel` from the repository.
- Return expected outcomes ("not linked", "not connected", "not found") as domain
  results or typed error variants, not as a database error string-matched upward.
  The GitHub link status endpoint answered "not linked" through the error path and
  logged three ERROR lines per call across every `#[instrument(err)]` layer.
- New queries: follow the [database guide](../development/database.md) and run
  `nix develop --command just prepare_db` before step 6, which builds offline.

## 2. Route and handler (required)

Put the handler in the owning crate's `src/inbound/axum_router.rs`. Some older
services (notification, auth) keep handlers in `services/<svc>/src/api/`; extend
those in place, but new routers live in the crate.

- **Authentication:** `MacroAuthorizationExtractor<Auth, Policy>` with the
  narrowest policy in `crates/macro_authorization/src/inbound/axum/policy.rs`
  (`UserOnly`, `UserOrInternal`, `InternalOnly`, `UserOrBot`, ...).
- **Authorization: every route keyed by an entity id needs that entity's access
  extractor** from `crates/entity_access/src/inbound/axum_extractors/`
  (`DocumentAccessExtractor`, `ForeignEntityAccessLevelExtractor`,
  `ChannelAccessLevelExtractor`, ...) at the right level (`ViewAccessLevel`,
  `EditAccessLevel`, `OwnerAccessLevel`, team roles). A DSS job-results route
  shipped authenticated but without any access check; team bot and channel label
  routes shipped with a level that was too loose and were tightened later. Decide
  owner-only vs editor operations explicitly.
- **Middleware the extractor depends on:** `DocumentAccessExtractor` and handlers
  that read `Extension<DocumentBasic>` need `ensure_document_exists_middleware` on
  that route. Without it every request is a 500; eight DSS internal routes were
  dead this way. Layer it like `services/document_storage_service/src/api/documents.rs`.
- Shared services come in through `State`, never `Extension` (CS-30).
- Paths use axum 0.8 syntax: `/{id}`.
- **Status codes:** implement `IntoResponse` for the domain error in the inbound
  module (copy `impl IntoResponse for GithubPullRequestError` in the same router
  file). Map client and expected states to 4xx: missing entity 404, no grant 401/403, "not connected"
  409. A missing Cursor key mapped to 502 made up 95% of a service's prod 5xx.
  Distinguish "doesn't exist (yet)" from "refused": a read racing its own create
  was reported to users as permanent no-access. Don't echo internal error text in
  500 bodies.
- `#[tracing::instrument(err, skip_all)]` on the handler; spans and log levels
  follow the [observability rule](../../.agents/rules/observability.md) and CS-22
  in [rust/code.md](../../.agents/rules/rust/code.md). Expected 4xx outcomes are
  not ERROR logs.
- Never put a secret in the path (it lands in access logs and traces); key routes
  on the record's id.

## 3. Mount the router (only for a new router)

Adding a route to an existing router needs nothing here. For a new router in DSS,
copy `channel_labels`:

- `services/document_storage_service/src/api/context.rs`: type aliases for the
  service and router state, and a field on the context.
- `services/document_storage_service/src/server.rs`: construct the state.
- `services/document_storage_service/src/api.rs`: `.nest("/<prefix>", ...)` inside
  `dss_router`.
- If the service now depends on a crate it didn't before, add it to the service's
  `Cargo.toml` and run `cargo x deps` (`just hakari`); commit
  `crates/workspace-hack` and `.github/workspace-dep-closures.json`.

## 4. OpenAPI registration (required)

- Annotate the handler with `#[utoipa::path]`: method, `tag`, a unique
  `operation_id` (it becomes the generated function name), `path`, `params`,
  `request_body`, and every status the handler can return with
  `body = ErrorResponse` for errors.
- **`path` is the route as the service serves it, nest prefix included, without
  the gateway prefix** (`/github_pull_requests/{id}`, not
  `/dss/github_pull_requests/{id}`). Clients carry the gateway prefix in their base
  URL. Calendar once baked `/calendar` into its annotations and the SDK had to
  strip it; that was reverted to root-relative.
- Path and query structs derive `IntoParams` (with
  `#[into_params(parameter_in = Path)]` for path params); bodies and responses
  derive `ToSchema`.
- **Register the handler** in the service's `#[openapi(paths(...))]` list and its
  types in `components(schemas(...))`, in `services/<svc>/src/api/swagger.rs`
  (properties: `crates/properties_service/src/api/swagger.rs`). An unregistered
  handler serves traffic but never reaches any client. A domain crate was once merged with
  its routes unwired and needed a second PR to mount and register them.
- Schema names are global per spec. Give types domain-specific names (or
  `#[schema(as = ...)]`) so two `ListResponse`s don't collide.

## 5. Wire shape (required)

- Derive `Serialize`/`Deserialize`/`ToSchema` on the domain type itself; add a
  separate wire type only when the shape genuinely differs (CS-69).
- Match the casing of sibling endpoints (`#[serde(rename_all = "camelCase")]` in
  newer DSS routers, snake_case in notification). Sibling endpoints on a resource
  share one DTO shape (CS-35), and new models mirror their existing counterpart
  (CS-32).
- Closed string sets are enums (CS-11); optional is `Option<T>` (CS-12), which
  the generated types render as `field?: T | null`; handle both absent and `null`.
- Timestamps are `chrono::DateTime<Utc>`, not `String`, so the spec says
  `format: date-time`.
- IDs that can exceed 2^53 (GitHub ids are `u64`) lose precision as JS numbers;
  serialize them as strings in responses the web reads.
- **Deployed clients outlive your PR.** Web, the iOS app, the SDK, MCP clients,
  and other services run older code against the new server, and web can ship
  before the backend. Add fields and params as optional; keep accepting old values
  (`unsubscribe_item.rs` still accepts `"email"` and `"thread"` item types); never
  rename or remove a field, path, or status in place. Removing an endpoint comes
  after every caller is gone. Migrations follow the
  [compatible migrations rules](../development/database.md#compatible-migrations).

## 6. Regenerate clients (required)

From `apps/web`:

```sh
bun run gen-api <service>          # e.g. cloud-storage, notification-service, agent-harness
```

Names come from `apps/web/scripts/services.ts`. This builds
`<crate>_openapi` with `SQLX_OFFLINE=true`, writes
`apps/web/src/lib/service-clients/service-<name>/openapi.json`, and reruns orval
into `generated/`. Then from `packages/sdk`:

```sh
bun run sync-specs && bun run generate
```

`just update-generated` in `packages/sdk` does both steps, for every service.

- Commit `openapi.json`, `generated/`, `packages/sdk/specs/`, and
  `packages/sdk/generated/`. The *Generated Code Check* job in
  `.github/workflows/web-app-check-main.yml` reruns both and fails on any diff.
- Never hand-edit `generated/`, `openapi.json`, or the SDK specs. Fix the Rust
  annotation and regenerate.

## 7. Web client and query (required if the web app calls it)

- Add a method to `apps/web/src/lib/service-clients/service-<name>/client.ts`,
  typed with the generated schema types (`./generated/schemas/<type>`). DSS calls
  go through `dssFetch`, other services through `fetchWithToken` with their
  `SERVER_HOSTS` entry. The orval-generated `client.ts` functions are not used by
  the app; don't build URLs from another service's host (calendar calls built on
  the email host 404'd when routes moved).
- Wrap it in a query or mutation under `apps/web/src/lib/queries/<area>/` (or the
  feature's `queries/` directory) with a `keys.ts`. UI never imports a service
  client (FE-01, enforced by ast-grep). Follow the
  [data rule](../../.agents/rules/web/data.md) for query factories, `enabled`,
  cache seeding, and Suspense boundaries.
- Optimistic mutations that mint ids client-side must survive an older backend
  that ignores the id: reconcile with the id the server returns.

## 8. SDK (required)

Wrap the endpoint or record it as skipped with the
[`add-sdk-endpoint` skill](../../.agents/skills/add-sdk-endpoint/SKILL.md).
`.github/workflows/sdk-check.yml` runs `bun run coverage` and fails on an
uncovered endpoint.

## 9. Other callers (optional)

- **Other Rust services:** extend the hand-written client crate
  (`crates/document_storage_service_client`, `crates/email_service_client`, ...)
  and gate the route with `InternalOnly`/`UserOrInternal`.
- **New top-level path on a gateway service:** a path outside the service's
  existing prefix isn't routed until its gateway path patterns cover it (see
  `infra/packages/shared/src/gateway_priorities.ts` and the service's stack).
  Prefer staying under the existing prefix.
- **User-visible behavior:** update the matching page in
  [docs/agent-guide](../agent-guide/README.md).

## Verify locally

```sh
cargo test -p <domain crate>                     # SQLX_OFFLINE unset
just rust-check && just clippy
(cd apps/web && bun run gen-api <service> --check)
(cd packages/sdk && just coverage)
just check
```

Run the stack ([running locally](../development/running-locally.md)) and call the
route through the proxy, for example
`curl https://localhost:8090/dss/<path>` with a token, once with access and once
without. Confirm the denied call is a 4xx, not a 500. Exercise the UI that uses it,
and find the request's trace with the `live-debug` skill.
