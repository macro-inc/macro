# Delete Gmail Attachment Utility

This binary is used to delete any gmail attachments we uploaded for the user(s) from Macro.

## Required Environment Variables

| Variable             | Description                                                     | Required |
|----------------------|-----------------------------------------------------------------|----------|
| `DATABASE_URL`       | The connection string for the PostgreSQL database               | Yes      |
| `DSS_URL`            | The URL for the Document Storage Service                        | Yes      |
| `INTERNAL_AUTH_KEY`  | An access token for authenticating with internal Macro services | Yes      |
| `MACRO_IDS`          | The Macro IDs of the user accounts to delete attachments for    | Yes      |
| `DELETE_CONCURRENCY` | Number of concurrent uploads to process (defaults to 10)        | No       |

## Setup

1. Ensure all required environment variables are set
2. Run the binary using cargo
