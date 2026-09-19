# Convert Service Helpers

This directory contains helper functions for the Convert Service.

## Backfill

The backfill script is used to backfill the Convert Service with docx files.

### Running the backfill script

To run the backfill script, you need to provide the following environment variables:

- `BASE_URL`: Convert service origin with no trailing slash. On the gateway that is `https://dev-gateway.macro.com/convert` or `https://gateway.macro.com/convert`. The legacy host still works during cutover.
- `INTERNAL_API_KEY`: The internal API key for the Convert Service.
- `LIMIT`: The maximum number of documents to backfill.
- `OFFSET`: The offset to start backfilling from.

You can run the backfill script using the following command:

```bash
bun backfill
```

This script will continuously backfill the Convert Service with docx files until there are no more documents to backfill.
