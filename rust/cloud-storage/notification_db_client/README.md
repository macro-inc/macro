## Running tests

```bash
cd macro-api
docker-compose up macrodb

cd macro-api/cloud-storage/notification_db_client

DATABASE_URL=postgres://user:password@localhost:5432/notificationdb sqlx database setup

cargo t
```
