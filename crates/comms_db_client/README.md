# Comms Service Database Client

This service is responsible for handling live communications between users.
The service entrypoint is the `comms_service` crate.
This crate is an external wrapper for the database client itself.


## Local Database Setup

From the repository root:

```bash
just run_dbs -d
```

Now go to `crates/comms_db_client`:

Your DATABASE_URL environment variable should already be set in the `.env` file

```bash
sqlx database setup
```

To reset your local database, run the following commands:

```bash
sqlx database drop -y
```
