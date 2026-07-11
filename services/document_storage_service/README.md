# Document Storage Service

## Usage

You can use the **/docs** endpoint for a full swagger.

## Prerequisites

Install and setup **Rust** ecosystem on your machine.

You will also need **sqlx-cli** installed with `cargo install sqlx-cli`.

The repository-root `just run_dbs` recipe starts the required PostgreSQL and Redis services.

## Commands

In case you are unfamiliar with **cargo** I have setup some make commands to
help ease the transition from using other cli tooling.

`make prepare_db` - Prepares sqlx for caching to be built in docker/deployment
`cargo install` - Installs dependencies
`cargo test` - Test service -- Need postgresdb running
`cargo build` - Build service in dev mode
`cargo build --release` - Build service in release mode
`cargo run --features local` - Runs the service in local mode
`cargo run` - Runs the service normally with AWS access required

## Local Development

From the repository root, start the database and Redis with `just run_dbs`.

One-time setup: run `just initialize_dbs` from the repository root to apply the
latest database migrations.

You'll want to populate the DB with a basic user for testing. At this time no
roles/permissions or organizations are required in DSS so I don't bother using
any setup scripts.

Create and fill in your `.env` file based on the `.env.sample`:
`cp .env.sample .env`

### Testing

When testing you will need to be running the `macrodb` and the redis cluster
docker images (see **local development**). You will need to export the database url
before running `cargo test`: `export DATABASE_URL=postgres://user:password@localhost:5432/macrodb`

## Creating Docker Image

Before you create the docker image using either the docker build command
or `pulumi up`, you will need to have the local db running and run
`make prepare_db` this will create the necessary `.sqlx` files to allow for us
to build the application without needing a direct DB connection.

## Contributing

After completing your feature work, you may need to re-generate the sqlx
cache so that our CI is able to successfully test and build the service.
To do this, run `make prepare_db` with your local postgres instance running in
docker.
