# Docx Unzip Handler

Handles taking docx files from an s3 bucket and converting them into Bill Of Materials.

## Prerequisites

- Install and setup *Rust* ecosystem on your machine.
- [Cargo lambda](https://www.cargo-lambda.info/guide/installation.html)
- *sqlx-cli* installed with `cargo install sqlx-cli`.

## Commands

`make prepare_db` - Prepares sqlx for caching for build step
`make build` - Builds lambda for release

## Local Development
Start docker containers - `docker-compose -f docker-compose.dev.yml up macrodb`

One time setup -- connect to the local database and run the following command:
    `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

# See `database/README.md` for more information on how to set up the database, this information is now deprecated
One time setup -- cd `database/prisma` and
run `DATABASE_URL=postgres://user:password@localhost:5432/macrodb npx prisma db push`
to ensure you have the latest prisma schema in your local database.

Create and fill in your `.env` file based on the `.env.sample`

### Running

To start the lambda you can run `cargo lambda watch`
If you wish to run in local mode (does not call AWS resources)
you can use `--features local`.

To invoke the lambda you run the following:

```bash
cargo lambda invoke --data-ascii "{\"Records\":[{\"eventTime\":\"2019-10-16T00:00:00Z\",\"userIdentity\":{},\"requestParameters\":{},\"responseElemnts\":{},\"s3\":{\"bucket\":{\"name\":\"BUCKET_NAME\"},\"object\":{\"key\":\"DOCX_FILE_PATH\"}}}]}"
```

## Testing

You must have the macrodb up and running locally to perform testing.

`cargo test` to run tests

## Contributing

After completing your feature work, you may need to re-generate the sqlx
cache so that our CI is able to successfully test and build the service.
To do this, run `make prepare_db` with your local postgres instance running in docker.
