# artifacts

## What it is

Artifacts: agent-written web pages published as Macro documents of file type
`artifact`. This crate owns their versions, file storage, API and the separate
origin pages are served from. How it works: [architecture](../../docs/architecture/artifacts.md).

## Start here

- `src/domain/manifest.rs`: every bundle rule (paths, limits, content types, scenes, digests).
- `src/domain/service.rs`: create, publish, restore, uploads, `view_url`, content, `place`.
- `src/inbound/content_router.rs`: the artifact origin, its headers and `dispatch_by_host`.

## Scope

- Owns: `artifact_versions`, objects at `artifacts/<document_id>/<sha256>`, the
  `/artifacts` API, the content router.
- Not here: the artifact document itself (creation, sharing, deletion) →
  `crates/documents`; deleting its objects → DSS's delete document worker,
  which removes the `s3_key::build_artifact_document_prefix` prefix; the token encoding → `macro_sync_service_jwt::artifact_content`;
  the canvas node itself → `documents::domain::canvas::CanvasEmbedder` and the
  editing worker, behind the `ArtifactCanvases` port.

## Boundaries

- Depends on: `entity_access` (document receipts), `entity_registry` (creation principal).
- Used by: `services/document_storage_service`, which implements
  `ArtifactDocuments`, `ViewTokens` and `ArtifactCanvases` in `src/outbound/artifacts.rs`, mounts the
  API at `/artifacts` and dispatches content hosts before its own router.

## Checks

- `cargo test -p artifacts` (repository tests need MacroDB; set `DATABASE_URL`).
- After query changes: `nix develop --command just prepare_db` from the repository root.
- After API changes: `bun run gen-api` in `apps/web`, then the SDK storage client.

## Gotchas

- Never let an artifact host reach the API router or another host reach the
  content router; `dispatch_by_host` is the only entry and is tested.
- The content router sets no cookies and reads no credentials but the path token.
- The create body spells the folder `project_id`; `CreateArtifactBody` copies it
  to `projectId` so the shared project extractor checks edit access.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` (`ArtifactContentUrl`), `.agents/rules/observability.md`
