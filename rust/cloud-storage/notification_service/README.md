# Notification Service

This service is responsible for processing and storing notifications.

## Local Database Setup

From the root of `macro-api`:

```bash
docker-compose up macrodb -d
```

Now go to `cloud-storage/notification_service`:

Set your DATABASE_URL environment variable:

```bash
cp ./.env.sample ./.env
```

Now that the database is running, you can run the following commands from `cloud-storage/notification_db_client`:
This will create the database and run any migrations.

```bash
sqlx database setup
```

To reset your local database, run the following commands:

```bash
sqlx database drop -y
```
