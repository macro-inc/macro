# Lexical Service API
This is a Bun service that provides API endpoints for converting Lexical documents to various formats.
It uses OpenAPI 3.1 with [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

The service fetches documents from the `sync-service/document/{id}/raw` endpoint and uses the nodes and
utilities from the shared `packages/lexical-core` workspace package. In general the pattern should be to define the
utilities in lexical-core and then bind them to endpoints here.

It runs on ECS behind the gateway at [https://dev-gateway.macro.com/lexical](https://dev-gateway.macro.com/lexical)
and [https://gateway.macro.com/lexical](https://gateway.macro.com/lexical) (`infra/stacks/lexical-service`,
`docker/lexical-service.Dockerfile`) and must be called internally with an 'x-internal-auth-key' header set.

# Endpoints
## /plaintext/<document-id>
Returns the plaintext version of the document.

## /health
Returns a health check response.

## /search/<document-id>
Returns the pre-processed document to be uses in the search processing service.

## /cognition/<document-id>
Returns the pre-processed document to be uses in the cognition service.

## POST /snapshot/markdown
Accepts `{ "markdown": "..." }` and returns an `application/octet-stream` Loro snapshot equivalent to the markdown block migration path.

## POST /snapshot/notion
Accepts `{ "markdown": "...", "links": { "pages": { "<notion id>": { "documentId", "name" } }, "users": { "<notion id>": { "userId", "email" } } } }`
with a page in Notion's enhanced markdown and returns `{ "snapshot": "<base64 Loro snapshot>", "markdown": "<Macro markdown>" }`.
Notion ids are dashless and lowercase. Mapped page and people references become document and user mentions;
the rest degrade to links or text (`packages/lexical-core/notion/`). Deploy this endpoint before the import backend that calls it.

## POST /image-markdown
Accepts `{ "staticFileId": "<uuid>", "url": "https://...", "width": 1536, "height": 1024 }`
and returns `{ "markdown": "..." }` built from the shared Lexical image node.
Requires internal authentication. Dimensions must be positive integers. The serialized
image retains intrinsic dimensions and uses 400px channel attachment bounds.
Deploy this endpoint before the image-generation backend that calls it.

# Local Development
The local stack (`just run_local`) builds and runs the service as `lexical_service` on port 8096, authenticated with
the stack's `INTERNAL_API_SECRET_KEY`. There are scripts to run document ids against the local endpoints.
For example: `bun run <search | plaintext | cognition> <document-id>` will curl the local endpoints.

# Secrets
The service reads `INTERNAL_AUTH_KEY` (callers' `INTERNAL_API_KEY`), `SYNC_SERVICE_AUTH_KEY` and `SYNC_SERVICE_URL`
from its environment (`src/server.ts`). On ECS they come from the `lexical-service` Doppler project and Secrets Manager.

# Deploy
Deploys go through the generic service pipeline (`.github/services-config.json`): dev on push to `main`, prod on
release. Never deploy by hand without permission.
