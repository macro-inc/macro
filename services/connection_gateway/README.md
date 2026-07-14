# Connection Gateway

A service responsible for managing connections, and allowing services to send messages to a specific entity over a websocket connection.

## Local Development
*runs on port 8085*

```bash
cp .env.sample .env
cargo run --features local_auth
```

## Utility Scripts

### Stale Connections

This utility scans the DynamoDB table for stale WebSocket connections using the same timeout logic as the service (60 seconds).

#### Running the script:

```bash
# Basic usage - shows statistics only
cargo run --bin stale_connections -- your-table-name

# Using environment variable
export CONNECTION_GATEWAY_TABLE=your-table-name
cargo run --bin stale_connections

# Delete stale connections (with confirmation prompt)
DELETE_STALE=1 cargo run --bin stale_connections -- your-table-name
```
