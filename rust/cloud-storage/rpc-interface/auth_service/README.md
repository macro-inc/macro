# auth_service_rpc

RPC interface for the authentication service, supporting both server and client modes.

## Features

- `server`: Enable server-side router generation (Axum)
- `client`: Enable client-side implementation with WASM support

## Building for WASM (Vite)

To build the WASM module for use with Vite:

```bash
wasm-pack build --target bundler --features client
```

This will generate a `pkg/` directory containing the WASM module and JavaScript bindings.

### Development Build

For faster builds during development:

```bash
wasm-pack build --target bundler --features client --dev
```

### Using in Vite

In your Vite project, you can import the generated package:

```javascript
import init, { LegacyGqlRpcClient } from './path/to/pkg/auth_service_rpc.js';

await init();

const client = LegacyGqlRpcClient.construct('https://api.example.com');
const permissions = await client.get_legacy_user_permissions();
```

## Usage

### Server

```rust
use auth_service_rpc::LegacyGqlRpc;

// Implement the trait for your service
impl LegacyGqlRpc for MyService {
    // ... implementation
}

// Build the router
let router = LegacyGqlRpcRouterBuilder::new(my_service).build();
```

### Client (Rust)

```rust
use auth_service_rpc::{LegacyGqlRpc, LegacyGqlRpcClient};

let client = LegacyGqlRpcClient::builder()
    .build("https://api.example.com".parse().unwrap())
    .unwrap();

let permissions = client.get_legacy_user_permissions(()).await?;
```
