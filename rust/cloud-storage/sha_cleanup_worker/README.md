# Sha Cleanup Worker

Worker to run periodically and clean up and sha's from S3 that are part of the bucket:sha-delete set in redis.

## Prerequisites

- Install and setup *Rust* ecosystem on your machine.

## Commands

`make install` - Installs dependencies
`make test` - Test service -- Need postgresdb running
`make build` - Build service in dev mode
`make release` - Build service in release mode
`make run-local` - Runs the service in local mode
`make run` - Runs the service normally with AWS access required

## Local Development
Start docker containers - `docker-compose -f docker-compose.dev.yml up macrocache`

Create and fill in your `.env` file based on the `.env.sample`

### Running in "Local" Mode

Local mode bypasses all AWS operations and will simply return dummy information
for any of their calls.

`cargo run --features local` OR `make run-local`

### Running in "Cloud" Mode

Cloud mode requires you have valid AWS credentials and have setup the correct
environment variables for any AWS specific configurations such as document
storage s3 bucket and table.

`cargo run` OR `make run`

## Testing

You must have the macrocache up and running locally to perform testing.

`cargo test` to run tests
