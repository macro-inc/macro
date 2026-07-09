---
name: cloud-storage-hexagonal-architecture
description: Enforce hexagonal architecture in the Rust cloud-storage backend. Use before modifying rust/cloud-storage crates, especially inbound axum/tool/listener adapters, domain services/ports, outbound adapters, authorization, permissions, database access, or external clients.
---

# Cloud Storage Hexagonal Architecture Guard

Use this skill whenever you add, change, or review Rust code under `rust/cloud-storage/**` that touches a crate with `src/domain`, `src/inbound`, or `src/outbound`.

This repository follows the ports-and-adapters / hexagonal style described in _Master Hexagonal Architecture in Rust_ and the `howtocodeit/hexarch` `3-simple-service` branch: domain models + ports + services are the center; inbound and outbound adapters are replaceable shells around that center.

## Non-negotiable dependency rule

Dependencies point inward:

```text
inbound adapters ──► domain ports/models/services ◄── outbound adapters
composition root ──► inbound + domain service + outbound implementations
```

- `domain/` must not depend on `inbound/`, `outbound/`, `axum`, HTTP response types, SQLx pools/queries, AWS SDKs, Redis, reqwest, environment variables, or transport DTOs.
- `inbound/` may depend on domain ports/models/services. It must not own business decisions or persistence/external-service implementation details.
- `outbound/` implements domain ports for databases, S3, HTTP clients, queues, metrics, etc. It must not own use-case policy.
- Wiring concrete adapters into services belongs in the composition root / builder, not inside domain logic or handlers.

## Layer responsibilities

### Domain (`src/domain/**`)

Put the following here:

- Domain models, value objects, command/request types, response types, and domain errors.
- Service/use-case traits exposed to inbound adapters.
- Concrete domain service implementations that orchestrate a use case.
- Port traits for required capabilities: repositories, authorizers, notifiers, event publishers, clocks, ID generators, metrics, external domain services.
- Business invariants, state transitions, authorization policy, ownership checks, permission-level checks, tenant/team/workspace policy, filtering rules, and side-effect orchestration.

### Inbound adapters (`src/inbound/**`)

Axum handlers, AI tools, Kafka/listener handlers, lambda handlers, and CLI entrypoints are adapters. Keep them thin:

- Extract authentication/identity from transport (`MacroUserExtractor`, JWT, signed internal header, request context).
- Parse path/query/body/header data and perform transport/syntax validation.
- Convert transport DTOs into domain request/command types.
- Call exactly the appropriate domain service/port method.
- Convert domain success/errors into transport responses/status codes/tool output.

Inbound adapters must not:

- Decide whether a user may access/edit/delete/share/list an entity.
- Call `entity_access`, `roles_and_permissions`, repositories, SQLx, S3, Redis, SQS, reqwest, or other outbound implementations to make a use-case decision.
- Branch on `AccessLevel`, role, owner/admin/member, tenant/team membership, project membership, subscription tier, feature entitlement, entity state, or ownership for business policy.
- Filter returned entities by permissions or hide fields based on authz rules.
- Start transactions or compose multiple persistence/external calls as the core use case.

### Outbound adapters (`src/outbound/**`)

Put implementation details here:

- SQLx queries and transaction mechanics.
- AWS/Redis/OpenSearch/HTTP client calls.
- Mapping external errors to domain errors as required by a port contract.
- Implementing repository/authorizer/client/notifier ports.

Outbound adapters must not:

- Import `crate::inbound::*`, axum extractors/responses, or transport DTOs.
- Invent business policy beyond faithfully implementing the domain port contract.
- Decide use-case flow; return facts/capabilities/results for the domain service to decide.

## Authorization rule

Authentication can happen at the edge. Authorization belongs in the domain service.

Allowed in inbound:

- Reject missing/invalid credentials (`401` / unauthenticated).
- Extract `actor`, `request_context`, `user_id`, service identity, or internal principal.
- Pass that identity into the domain command/service call.

Forbidden in inbound:

- `if user_id != owner_id { ... }`
- `if access_level < Edit { ... }`
- `entity_access_service.check_*` followed by allow/deny.
- Role/team/tenant/project permission checks.
- Any `can_*`, `authorize_*`, `ensure_*permission*`, or `AccessLevel` decision that determines whether the use case is permitted.

Correct pattern:

1. Add a domain port when the service needs authz data, e.g. `DocumentAuthorizer`, `EntityAccessPort`, or reuse an existing domain service port.
2. Inject that port into the domain `Service`.
3. In the service method, perform `ensure_can_*` / permission checks before the protected action.
4. Return a domain error such as `Unauthorized`, `Forbidden`, or a typed policy error.
5. Let inbound map that domain error to HTTP/tool/listener semantics.
6. Unit-test allow and deny cases at the domain service level with fake ports.

## Bad vs good

Bad: authz and persistence leak into the handler.

```rust
pub async fn rename_document(
    Extension(user): Extension<MacroUserExtractor>,
    State(state): State<AppState>,
    Json(body): Json<RenameBody>,
) -> Result<Json<RenameResponse>, ApiError> {
    let access = state.entity_access.can_edit(user.id(), body.document_id).await?;
    if !access {
        return Err(ApiError::Forbidden);
    }

    let updated = state.document_repo.rename(body.document_id, body.name).await?;
    Ok(Json(updated.into()))
}
```

Good: the handler adapts transport; the domain service owns policy and orchestration.

```rust
pub async fn rename_document<S: DocumentService>(
    Extension(user): Extension<MacroUserExtractor>,
    State(state): State<AppState<S>>,
    Json(body): Json<RenameBody>,
) -> Result<Json<RenameResponse>, ApiError> {
    let command = RenameDocumentCommand {
        actor: user.into_actor(),
        document_id: body.document_id,
        name: body.name.try_into()?,
    };

    state
        .document_service
        .rename_document(command)
        .await
        .map(Json::from)
        .map_err(ApiError::from)
}
```

```rust
impl<R, A> DocumentService for Service<R, A>
where
    R: DocumentRepository,
    A: DocumentAuthorizer,
{
    async fn rename_document(&self, command: RenameDocumentCommand) -> Result<Document, DocumentError> {
        self.authorizer
            .ensure_can_edit(&command.actor, command.document_id)
            .await?;

        self.repo.rename(command.document_id, command.name).await
    }
}
```

## Pre-write checklist

Before editing code, classify each touched file:

1. Is it `domain`, `inbound`, `outbound`, or composition/wiring?
2. What use case is being added or changed?
3. What domain command/model/error represents it?
4. Which domain service method should inbound call?
5. Which outbound capabilities are needed, and are they behind domain port traits?
6. What authorization/policy decisions are needed, and where will domain service tests cover them?

If a step has no answer, stop and design that boundary before writing code.

## Review checklist

For every diff under `rust/cloud-storage/**`, reject or refactor if any of these are true:

- `src/domain/**` imports `axum`, `http::StatusCode`, `IntoResponse`, `Json`, `Router`, `Request`, `HeaderMap`, SQLx pools/queries, AWS SDK clients, Redis clients, reqwest clients, `crate::inbound`, or `crate::outbound`.
- `src/inbound/**` contains SQLx queries, transaction handling, repository calls, AWS/Redis/OpenSearch/reqwest calls, or direct calls to outbound implementations.
- `src/inbound/**` contains authorization decisions (`AccessLevel`, role checks, owner checks, team/project membership checks, `can_*`, `authorize_*`, `ensure_*permission*`) instead of forwarding identity to a service.
- Handlers return domain-specific decisions not produced by a domain service.
- Outbound code imports inbound/transport DTOs or axum types.
- A domain service depends on concrete adapters rather than port traits/generic bounds/trait objects.
- Tests only cover HTTP status mapping and do not cover service-level allow/deny/business-rule cases.

## Useful inspection commands

Set `CRATE` to the crate you are touching, for example `CRATE=rust/cloud-storage/documents`.

```bash
# Domain must not know transport or concrete infrastructure.
rg -n "use (axum|http::StatusCode)|IntoResponse|Json<|Router|HeaderMap|Request<|sqlx::|PgPool|aws_sdk|redis::|reqwest|crate::inbound|crate::outbound" "$CRATE/src/domain" --glob '*.rs'

# Inbound authz/policy hits require inspection; most should move to domain service.
rg -n "entity_access|roles_and_permissions|AccessLevel|RoleId|owner|admin|member|tenant|team|project|permission|authorize|authz|can_|ensure_.*permission|Forbidden|Unauthorized" "$CRATE/src/inbound" --glob '*.rs'

# Inbound should not do persistence or infrastructure work.
rg -n "sqlx::|query!|query_as!|PgPool|Transaction|aws_sdk|redis::|opensearch|reqwest|S3|Sqs|Dynamo" "$CRATE/src/inbound" --glob '*.rs'

# Outbound must not depend on inbound transport.
rg -n "crate::inbound|axum|IntoResponse|Json<|Router|StatusCode|Extension<" "$CRATE/src/outbound" --glob '*.rs'
```

`rg` hits are not automatically failures, but every hit must be explained by layer responsibilities. When in doubt, move policy inward.

## If you find an existing violation

- Do not add more logic to the violating adapter.
- If the task touches that use case, prefer moving the policy/orchestration into the domain service as part of the change.
- If a full refactor is large or risky, stop and ask the user before making sweeping changes. Offer the smallest compliant plan that prevents new violations.

## Final response requirement

When you use this skill, explicitly state that the hexagonal boundary was checked and summarize where authz/business policy lives after your change.
