# Table Cleanup Handler

Lambda that when triggered will delete all items from a table you provide with a `createdAt` date longer than `x hours`

## Prerequisites

- Install and setup *Rust* ecosystem on your machine.
- [Cargo lambda](https://www.cargo-lambda.info/guide/installation.html)
- *sqlx-cli* installed with `cargo install sqlx-cli`.

## Commands

`make prepare_db` - Prepares sqlx for caching for build step
`make build` - Builds lambda for release

## Local Development
Start docker containers - `docker-compose -f docker-compose.dev.yml up macrodb`

Create and fill in your `.env` file based on the `.env.sample`

## Running

To start the lambda you can run `cargo lambda watch`

To invoke the lambda you run the following:

```
cargo lambda invoke --data-ascii "{\"id\": \"abc\", \"detail-type\":\"abcd\", \"detail\": {}, \"source\": \"source\"}"
```

## Testing

`cargo test` to run tests

## Contributing

After completing your feature work, you may need to re-generate the sqlx
cache so that our CI is able to successfully test and build the service.
To do this, run `make prepare_db` with your local postgres instance running in docker.
