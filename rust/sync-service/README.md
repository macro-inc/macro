# Sync Service
Service responsible for syncing collaborative documents between multiple users.

## Project Structure
```bash
.
├── bebop/ # bebop schema and ts generator for tests & qa
├── build.rs # build script for worker, to generate bebop rust bindings
├── justfile # justfile for running commands
├── src/ # rust worker-rs worker
├── tests/ # e2e tests using miniflare and vitest
└── wrangler.toml # wrangler configuration
```

## Architecture
The sync service leverages Cloudflare's Durable Objects to create session servers or "rooms" for each document. A Durable Object functions as a worker with both in-memory state and persistent storage capabilities.

Using Cloudflare's Durable Objects API, we can dynamically create and request these objects on demand for individual documents. To connect and receive updates from a document, a client establishes a WebSocket connection to /document/:document_id.

When a connection is established, the worker checks if a Durable Object already exists for the document and creates a new one if necessary. Each Durable Object maintains two types of state:

- In-memory state: Contains the loro_document itself, along with metadata about the document's current state
- Persistable state: Stores data that survives even when the in-memory state is cleared

The in-memory state and loro_document are initialized using a loro-snapshot retrieved from the Durable Object's persistent storage. By default, Durable Objects evict in-memory state after 10 seconds of inactivity. This can occur even when connections to the Durable Object exist, as long as there are no WebSocket messages or alarm invocations within that timeframe.

Since generating and importing loro snapshots is computationally expensive, we want to maintain the in-memory state as long as active connections exist. To accomplish this, we implement a "heartbeat" system by scheduling an alarm for 5 seconds into the future, similar to a debounce mechanism. Even without incoming WebSocket messages, this alarm fires regularly, preventing the in-memory state from being evicted.
When a client updates a document via a WebSocket message, we apply the update to the in-memory loro document. Whenever the alarm fires, we generate a new loro snapshot and store it in the Durable Object's persistent storage. When a new user connects to the document, we retrieve both the latest snapshot and any pending operations from persistent storage, then send a complete snapshot to the client.

### Authentication

`document_storage_service` will generate a jwt with permissions for the document. This jwt will be passed to the connecting websocket using queryParams.  
Unfortunately, query params are the best way to authenticate a websocket connection. Since we use tls, query params should be encrypted in transit.
the `sync-service` will verify the jwt and ensure that the user has the correct permissions to access the document.

TODO: eventually we will want to validate based on the `access_level` field in the token that the user only receives updates and does not push any updates to the document.


## Bebop
The bebop schema is defined in `./bebop/schema.bop`.

#### Generating typescript bindings locally
The typescript bindings are primarily used for testing and QA environemnt.
```bash
cd bebop && npx bebop-tools build
```

#### Generating rust bindings locally
Rust bindings get automatically generated when building the worker.
The behavior for this is defined in `./build.rs`.
```bash
worker-build --release
```

#### Generating bindings elsewhere
The sync_service exposes an endpoint `/schema` which returns the bebop schema.
A consuming client can fetch this schema during build time and generate the corresponding typescript / rust bindings.

## Features

By default `bebop-owned-all`, `alarm-keep-alive` and `create-default-state` are all enabled.

- `bebop-owned-all`: Enables all bebop owned types
- `create-default-state`: As of writing this there is no mechanism to initialize a document's state 
from existing state on the client. If a client fetches a document for the first time the worker will create
some default state for it. In the future, this feature should be disabled, and we should be inheriting default state
from the client.
- `alarm-keep-alive`: This feature is used to prevent the in-memory state from being evicted when there are still
active connections to the document. :warning: Tests should be run with both this feature enabled and disabled, to ensure
that in a case where eviction logic is not working as expected, the core logic is still correct even though it might be slower.

## Development

We have 3 environments "test", "dev", and "prod". When developing we typically use "testing". This is deployed with `npx wrangler deploy`, dev with `npx wrangler deploy --env dev`, and prod with `npx wrangler deploy --env prod`.

#### Testing

#### Running Locally
Run:

```bash
npx wrangler dev
# or
just dev
```

If you run into build errors related to clang, follow [this fix](https://github.com/briansmith/ring/issues/1824#issuecomment-2059955073):

Ensure you have llvm installed and available on your `PATH`. For mac with zsh this looks like:
```
# install llvm
brew install llvm
# add it to your PATH for zsh
echo 'export PATH="/opt/homebrew/opt/llvm/bin:$PATH"' >> ~/.zshrc
```

#### Running tests locally
```bash
# runs only unit tests
cargo test

# runs both unit tests and e2e tests
just test

# runs e2e tests with the alarm-keep-alive feature disabled
just test-no-alarm
```

when making a new deploy you need to make a cloudflare KV store
and D1 database 
