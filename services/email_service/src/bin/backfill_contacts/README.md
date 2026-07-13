# Backfill Contacts Script

This binary is used to backfill a user's email contacts into contacts_service.

Specifically, it creates contacts for any email the user has previously sent an email to.

## Required Environment Variables

| Variable         | Description                                                 | Required |
|------------------|-------------------------------------------------------------|----------|
| `DATABASE_URL`   | The connection string for the PostgreSQL database           | Yes      |
| `MACRO_IDS`      | The Macro IDs of the user accounts to backfill contacts for | Yes      |
| `CONTACTS_QUEUE` | URL of queue to put messages on for contacts_service        | Yes      |

## Setup

1. Ensure all required environment variables are set
2. Run the binary using cargo