# Search Processing Service

This service is responsible for processing search text extraction messages and updating the OpenSearch content for cloud storage items.

## Running Locally

The `localdev` sops bundle already carries every env var this service needs (dev `DATABASE_URL`, dev OpenSearch creds, `ENVIRONMENT=local`, dummy `SYNC_SERVICE_AUTH_KEY` / `LEXICAL_SERVICE_URL` that are unused by most processors). Requires valid AWS credentials for secrets manager + SQS.

From the repo root:

```bash
just get_environment localdev                    # writes .env at repo root
cd rust/cloud-storage/search_processing_service
cargo run
```

Override `SEARCH_EVENT_QUEUE` on a per-run basis (e.g. backfills onto a scratch queue) so you don't consume the shared dev queue:

```bash
SEARCH_EVENT_QUEUE=search-event-queue-<scope>-<you> cargo run
```

To run the API surface without the worker loop:

```bash
cargo run --features disable_processing
```
