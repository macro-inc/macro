# Changes

- New endpoint for creating a simple new markdown file. Use this endpoint in both `create.ts` and in `instructions.md` creation
- backend now does checking for wether user already has an instructions.md document before creating a new one
- location / metadata response now includes a `content` fiels which describes where and what state the content of the document is in.
- create task now initializes the tasks content on the backend instead of on the frontend. using the document creator
- simplifies document creation in ai tool calls
