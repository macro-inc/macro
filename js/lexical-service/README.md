# Lexical Service API
This is a Cloudflare Worker that provides API endpoints for converting Lexical documents to various formats.
It uses OpenAPI 3.1 with [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

The service fetches documents from the `sync-service/document/{id}/raw` endpoint and uses the nodes and
utilities from the `lexical-core` package in app-monorepo. In general the pattern should be to define the utilities in
lexical-core and them bind them to endpoints here.

The services are deployed to [https://lexical-service-dev.macroverse.workers.dev](https://lexical-service-dev.macroverse.workers.dev)
and [https://lexical-service-prod.macroverse.workers.dev](https://lexical-service-prod.macroverse.workers.dev) and must
be called internally with an 'x-internal-auth-key' header set.

# Endpoints
## /plaintext/<document-id>
Returns the plaintext version of the document.

## /health
Returns a health check response.

## /search/<document-id>
Returns the pre-processed document to be uses in the search processing service.

## /cognition/<document-id>
Returns the pre-processed document to be uses in the cognition service.

# Local Development
`bun run dev` will start the development server with the wrangler env set to 'local' and the port set to 8931. The local
environment uses 'local' as the INTERNAL_API_SECRET_KEY. There are scripts to run document ids against the local endpoints.
For example: `bun run <search | plaintext | cognition> <document-id>` will curl the local endpoints.

### Env
You will need a file called `.dev.vars.local` with the following secrets:

```
INTERNAL_API_SECRET_KEY="local"
SYNC_SERVICE_AUTH_KEY="<secret>"
```

# Secrets
The service relies on two secrets:
- `INTERNAL_API_SECRET_KEY`
- `SYNC_SERVICE_AUTH_KEY`

Use `wrangler secret put <key name> --env <prod | dev>` to set the secrets in the cloudflare environment. These secrets are likely already set up in only need to be re-put when changed. You can run `wrangler secret list --env <prod | dev>` to see the current secrets.

# Deploy
`bun run deploy-dev` and `bun run deploy-prod` to deploy the services to the cloudflare environment.
