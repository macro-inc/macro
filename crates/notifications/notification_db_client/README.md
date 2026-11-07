## Running tests

```bash
just run_dbs

cd crates/notifications/notification_db_client

DATABASE_URL=postgres://user:password@localhost:5432/notificationdb sqlx database setup

cargo t
```
