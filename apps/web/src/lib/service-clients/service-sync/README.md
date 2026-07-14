# Sync Service Browser Adapter

App-only HTTP calls and permission-token refresh for the shared
`@macro-inc/collaboration/sync-service/*` transport.

Order of operations:
1. We get authentication token for the document
2. We connect to the websocket and receive the initial state
3. initial state gets applied to the source state in the block
4. we pull in changes from the server
