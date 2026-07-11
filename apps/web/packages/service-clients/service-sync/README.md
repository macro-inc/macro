# Sync Service Client
Sync provider

Order of operations:
1. We get authentication token for the document
2. We connect to the websocket and receive the initial state
3. initial state gets applied to the source state in the block
4. we pull in changes from the server
