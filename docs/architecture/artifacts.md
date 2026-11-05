# Artifacts

Agents write HTML pages, with their CSS, scripts, images and fonts, and publish
them as Macro items. People open, share and comment on them like documents,
browse their version history, and place a whole artifact or one of its scenes
on a canvas. This page covers the backend: the entity, storage, the API, and
the separate origin pages are served from. Code: `crates/artifacts`, hosted by
`services/document_storage_service`.

## An artifact is a document

An artifact is a `Document` with file type `artifact` (mime
`application/x-macro-artifact`, file association `Artifact`, route
`/app/artifact/<id>`). Sharing, Drive, Recent, Home, search (by name),
discussions and mentions are the document ones; there is no artifact entity
type. Creation goes through the documents domain's creation use case
(`DocumentCreator::create_artifact`), so owner, folder and share defaults match
every other created document.

The generic document paths refuse artifacts: `POST /documents` and file
uploads reject the file type, copying an artifact is refused (its body is its
version history), `location_v3` points callers at `view_url`, and the AI
`ReadContent` tool says the content is a web page. Search indexes the name
only.

## Versions

```text
artifact_versions
  id, document_id → "Document"(id) ON DELETE CASCADE, number (1, 2, 3 …)
  files    {"index.html": {"sha256", "size", "content_type"}, …}
  scenes   [{"id", "title", "path"}]
  message, created_by (user), created_by_agent (bot), created_at
  UNIQUE (document_id, number)
```

- Versions are immutable. The current version is the highest number. Restoring
  publishes an old manifest again as a new number; history is never rewritten.
- Bytes are content-addressed at `artifacts/<document_id>/<sha256>` in DSS's
  document bucket (`s3_key::build_artifact_object_key`), so unchanged files
  cost nothing across versions.
- Permanent deletion goes through DSS's delete document worker like every
  document: version rows cascade with the `Document` row, and the worker
  deletes the whole `artifacts/<document_id>/` prefix, which also holds bytes
  uploaded for a version that was never published.
- A publish names `base_version`; a different current version is a 409, and so
  is losing the race for the next number, so two agents can't overwrite each
  other silently.
- `created_by` is the acting user. `created_by_agent` is the agent acting for
  them: the bot of a bot credential, or the signed agent attribution
  (`agent_id`) of a Macro API token, such as the one the agent egress mints for
  a session. A caller with no acting user (a team bot, internal) can't publish.
- An artifact can exist with no version: `POST /artifacts` without files
  creates only the document, so large files can be uploaded before publishing
  version 1 with `base_version` 0. Until then `current` is null and `view_url`
  is a 404.
- Every publish and restore sends `artifact_published` (`{documentId,
  version}`) to the document's subscribers through the connection gateway.

Validation lives in the domain (`domain/manifest.rs`): paths are relative,
`/`-separated, without empty, `.` or `..` segments, at most 512 characters;
`index.html` is required; at most 255 files, 16 MiB per file and 64 MiB per
version; content types come from an allowlist; inline bytes must match their
sha256. Scene ids are slugs `[a-z0-9][a-z0-9-]{0,63}`, unique, and each scene's
path is one of the files.

## API

Mounted at `/artifacts` on DSS (utoipa tag `artifacts`, snake_case JSON).

| Route | Access | Does |
| --- | --- | --- |
| `POST /artifacts` | edit on `project_id` if given | Create the document, and version 1 when files are given (each with `content_base64`). 201. |
| `POST /artifacts/{id}/uploads` | edit | Presigned S3 `PUT`s for the digests not yet stored for this artifact. |
| `POST /artifacts/{id}/versions` | edit | Publish; files without content must already be stored. 201, 409 on a stale `base_version`. |
| `GET /artifacts/{id}` | view | The artifact and its current version. |
| `GET /artifacts/{id}/versions` | view | History, newest first, with file counts and sizes. |
| `GET /artifacts/{id}/versions/{number}` | view | One version. |
| `POST /artifacts/{id}/versions/{number}/restore` | edit | Publish that manifest again. 201. |
| `POST /artifacts/{id}/view_url` | view, anonymous via public link | A URL for an iframe, for a version and optionally a scene and theme. |
| `POST /artifacts/{id}/place` | view on the artifact, edit on `canvas_id` | Place the artifact or one scene on a canvas. 201 `{item_id}`. |

Create and publish bodies are limited to 32 MiB: inline content is for small
pages and code mode, large files go through `/uploads` (the presigned `PUT`
carries the sha256 checksum, so S3 refuses other bytes). Access checks are the
document ones: the artifact document is loaded, then `DocumentAccessExtractor`
mints the receipt the service takes. Because the shared project body extractor
reads `projectId`, the create handler hands it the `project_id` field.

## Serving on a separate origin

Pages run agent-written scripts, so they never run on a Macro origin. Each
artifact has its own origin, `<document_id>.<artifact content host>`, typed as
`ArtifactContentUrl` in `crates/macro_service_urls`:

| Environment | Content host |
| --- | --- |
| local | `artifacts.localhost:8086` (named stacks: their DSS port, via `OVERRIDE_ARTIFACT_CONTENT_URL`) |
| dev | `artifacts.dev.macro-agent-gateway.com` |
| prod | `artifacts.macro-agent-gateway.com` |

The preview gateway's `macro-agent-gateway.com` zone is reused because it is
already a registrable domain outside macro.com. One origin per artifact keeps
storage and service workers apart between artifacts and stable across
versions.

URLs are `<origin>/t/<token>/v/<number>/<path>`; an empty path is
`index.html`, a scene's `view_url` points at its page, and `?theme=light|dark`
passes the theme. The token is an artifact content token
(`macro_sync_service_jwt::artifact_content`), minted after the normal view
access check. The page can read its own URL, so the token is useless anywhere
but the content router: it is signed with DSS's existing permission secret
(HS256, one hour; the web app refreshes from `expires_at`) but names its own
issuer and the audience `artifact-content`, which every document grant
decoder (sync-service, DSS `permissions_token/validate`, surface grants)
rejects, and it carries no access level, so it can't pose as a document
grant either. A document grant is likewise refused by the content router. Putting it in the path keeps
every relative URL in a page working without the author knowing about it, and
needs no cookie, which browsers block in third-party frames.

DSS dispatches by `Host` before any other routing
(`content_router::dispatch_by_host`): requests for the content host or any host
under it reach only the content router, and no other host reaches it. The
content router verifies the token, checks it names the document in the host,
looks the path up in the version's manifest and streams the object from S3.

Every content response carries:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors <app origin> tauri://localhost http://tauri.localhost https://tauri.localhost [local frontends outside prod]
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-origin
Cache-Control: private, max-age=31536000, immutable   (no-store on errors)
```

- `connect-src 'self'` and the image and media rules mean a page can send
  nothing anywhere but its own origin, which serves only the artifact's files.
  The page holds nothing of the viewer's: no cookie, no API credential.
- Requests with `Sec-Fetch-Dest: document` get 403 and `frame-ancestors`
  allows only Macro app origins, so an artifact never renders as a top-level
  page that could pose as Macro at its own URL.
- A file's sha256 is its `ETag`; a matching `If-None-Match` gets 304.

The web app frames it as
`<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer">`;
`allow-same-origin` is safe because the origin is the artifact's own.

## Placing on a canvas

On a canvas an artifact is the canvas's ordinary `document` node with
`fileType: 'artifact'`, `display: 'embed'`, the artifact's name, and the scene
id as `subpath`; it follows the current version. People insert it from the
canvas UI. Agents and the SDK (`artifact.placeOn(canvas, …)`) call
`POST /artifacts/{id}/place {item_id?, canvas_id, scene?, x, y, width, height}`.
The placement is idempotent on `item_id`, the new node's canvas id (DSS
picks one when it is omitted; `placeOn` picks one per call and reuses it when
it retries a lost response):

1. The artifact document loads as for every route and `DocumentAccessExtractor`
   checks view access to it; the body's canvas loads through
   `ArtifactService::load_canvas` (400 unless its file type is `canvas`) and
   the same extractor checks edit access to it.
2. The service refuses an artifact with no published version, a scene the
   current version lacks, and geometry outside the canvas editing bounds
   (±1,000,000 world units, sizes up to 100,000), before touching anything.
3. It records the canvas's reference to the artifact through the
   `ArtifactCanvases` port, as a mention whose id is derived from the item id
   (uuid v5). DSS implements it with the channel service's
   `create_entity_mention`, the domain behind `POST /channels/mentions` that
   the canvas UI calls when it inserts a document node, and keeps a mention
   already recorded under that id.
4. It commits the node through the documents domain's `CanvasEmbedder`,
   which mints an edit permission token for the publisher (actor: their agent)
   and calls the editing worker's internal `embed` request on `POST /canvas`
   (see `services/ai-editing-worker/AI_EDITING.md`). The worker writes the node
   and the mention id into the canvas's `canvasMentions` map in the same flush,
   so the canvas UI's reference reconciliation sees it as already recorded.
   A node already under the item id (same document) is left as it is, and a
   mention already in the map is not written again.
5. When the embed fails, the error is returned and the mention stays.
   Retrying with the same `item_id` converges on one mention and one node,
   whether or not the failed attempt committed.

The span is `canvas.embed_artifact` (document_id, canvas_id, version, scene,
item_id); the worker's `canvas.ai.session` span (action `embed`) joins it.

## Infrastructure

- `infra/stacks/preview-gateway`: the ACM certificate for `*.<content host>`
  (validated in the preview zone) attached to the gateway ALB's HTTPS listener,
  and the Route53 wildcard record aliasing it to the gateway ALB.
- `infra/stacks/cloud-storage-service`: the gateway listener rule (priority
  `ARTIFACT_CONTENT_HOST`, ahead of the path rules) forwarding
  `*.<content host>` to the DSS target group.

## Traces

`artifact.create`, `artifact.publish`, `artifact.notify_published` (document_id, version, file_count,
bytes_inline, bytes_reused), `artifact.uploads`, `artifact.restore`,
`artifact.view_url` (document_id, version, scene) and `artifact.content`
(document_id, version, path, cache = `served` or `not_modified`). Tokens are
never recorded: the content router's request span records `url.path` as
`/t/<redacted>/v/<n>/<path>` (`MacroRequestIdAndTracingLayer::with_redacted_path`).
