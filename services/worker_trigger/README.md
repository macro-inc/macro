# Sha Cleanup Trigger

Lambda to trigger the "Sha Cleanup Worker" ECS task

## Prerequisites

- Install and setup *Rust* ecosystem on your machine.
- [Cargo lambda](https://www.cargo-lambda.info/guide/installation.html)

## Commands

`make build` - Builds lambda for release

## Running

To start the lambda you can run `cargo lambda watch`
If you wish to run in local mode (does not call AWS resources)
you can use `--features local`.

To invoke the lambda you run the following:

```
cargo lambda invoke --data-ascii "{\"id\": \"abc\", \"detail-type\":\"abcd\", \"detail\": {}, \"source\": \"source\"}"

```

## Testing

`cargo test` to run tests
