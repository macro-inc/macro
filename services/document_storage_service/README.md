# Document Storage Service

## Usage

You can use the **/docs** endpoint for a full swagger.

## GraphQL subscription compression

`GET /soup/graphql/ws` negotiates browser-native `permessage-deflate` for both
`graphql-transport-ws` and `graphql-ws`. Authentication and subscription context
are unchanged. Clients that omit compression or offer unsupported parameters
continue with uncompressed messages; no frontend decompressor is needed.

The transport in `src/api/graphql_soup/websocket.rs` uses Signal's tungstenite
fork pinned in the root `Cargo.toml`. The fork is based on 0.27, so it uses a
separate `tokio-tungstenite-signal` dependency (upstream Tokio adapter 0.27).
Other WebSocket endpoints retain their existing upstream dependencies.

Signal does not expose its handshake extension negotiation helpers publicly.
The Hyper adapter accepts known, unquoted RFC 7692 parameters with 9–15-bit
windows; quoted or unsupported offers fall back to uncompressed transport.
Both directions disable context takeover between messages. Existing default
frame/message size limits remain in place, including decompressed message limits.
The fork's `deflate` feature requires a zlib-compatible flate2 backend.

Transport regression tests (including wire-level compression and fallback):

```sh
cargo test -p document_storage_service --lib api::graphql_soup::websocket::test
```

### Measure payload savings locally

```sh
cargo test -p document_storage_service --lib measure_subscription_payload_sizes -- --nocapture
```

This starts a loopback Axum server using the production upgrade adapter and
subscribes twice to identical synthetic snapshots, with and without deflate.
The raw TCP reader counts actual WebSocket payload and frame bytes, checks RSV1,
and independently decompresses each message to verify identical JSON. No
recompression estimate, production data, or per-message production logging is
involved. The fixture is
`src/api/graphql_soup/websocket/measurement-entity.json`.

With the pinned dependencies, the local measurement is:

| Message | Plain payload | Deflate payload | Payload saved |
| --- | ---: | ---: | ---: |
| Connection acknowledgement | 25 B | 27 B | -8.00% |
| Synthetic 1-entity snapshot | 632 B | 360 B | 43.04% |
| Synthetic 25-entity snapshot | 13,120 B | 632 B | 95.18% |
| Synthetic 100-entity snapshot | 52,171 B | 1,349 B | 97.41% |
| Subscription completion | 34 B | 35 B | -2.94% |

These are controlled, repetitive fixtures, **not production traffic statistics**.
Small messages can grow. CSV `*_frame_bytes` columns also count the WebSocket
header; HTTP handshake, TCP/IP, and TLS overhead are excluded.

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
