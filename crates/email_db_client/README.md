## Running tests

```bash
just run_dbs

cd crates/email_db_client

DATABASE_URL=postgres://user:password@localhost:5432/emaildb sqlx database setup

cargo t
```
