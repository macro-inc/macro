# properties_service

## What it is

Part of the Databases and CRM features. Composition shim binding the
`properties` crate's axum router to concrete domain and authorization
service types, for embedding in a host service.

Note: `README.md` describes an older, service-owned-logic shape
(`properties_db_client`, `local_auth`) that no longer matches this crate —
the routes and domain logic now live entirely in `properties`.

## Start here

- `src/api/context.rs`: the concrete type aliases (`PropertiesService`,
  `AuthorizationServiceType`, `PropertiesHandlerState`) — this is the whole
  wiring decision this crate makes.
- `src/api.rs`: `router()`, which just returns
  `properties::inbound::axum_router::router()`.
- `src/openapi.rs`: the standalone OpenAPI-generation binary
  (`properties_service_openapi`).

## Scope

- Owns: picking concrete adapter types (Postgres repo, MacroAuthorization,
  SQS notification ingress) for `properties`' generic router.
- Not here: route handlers or domain logic → `properties`.

## Boundaries

- Depends on: `properties`, `entity_access`, `macro_authorization`,
  `notification`.
- Used by: `services/document_storage_service`.

## Checks

- `cargo test -p properties_service` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
