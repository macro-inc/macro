# Attachment Backfill Utility

This binary is used to find and upload relevant email attachments for a given user account to DSS.
It fetches attachment metadata from the local database based on several heuristics,
downloads the actual attachment data from Gmail, and uploads it to document storage service.

## Required Environment Variables:

- `DATABASE_URL`: The connection string for the PostgreSQL database.
- `DSS_URL`: The URL for the Document Storage Service.
- `INTERNAL_AUTH_KEY`: The access token for authenticating with internal Macro services.
- `MACRO_IDS`: The Macro IDs of the user accounts to backfill attachments for
- `UPLOAD_CONCURRENCY`: Number of concurrent uploads to process (optional, defaults to 10).
- `FUSIONAUTH_API_KEY`: The API key for authenticating with FusionAuth.
- `FUSIONAUTH_BASE_URL`: The base URL for the FusionAuth service.
- `FUSIONAUTH_IDENTITY_PROVIDER_ID`: The identity provider ID for FusionAuth.
- `GMAIL_CLIENT_ID`: The client ID for Gmail OAuth.
- `GMAIL_CLIENT_SECRET`: The client secret for Gmail OAuth.
