# chat_message

## What it is

Part of AI: the role (`Role`) and content (`ChatMessageContent`,
`AssistantMessagePart`) of a stored AI chat message, shared by the agent loop,
the chat domain, and the crates that persist or ship messages.

## Scope

- Owns: the serde and OpenAPI (`schema` feature) shape of message roles and
  content.
- Not here: `ChatMessage`/`ChatMessages` with resolved attachments → `crates/ai/agent_loop`
  (`agent::types`, which also re-exports this crate's types).

## Boundaries

- Depends on: serde, serde_json, strum; utoipa only with `schema`.
- Used by: `agent`, `chat`, `model`, `macro_db_client`.

## Gotchas

- Keep it a leaf: no workspace crates, no I/O. It is a hakari traversal
  exclude, so it has no `workspace-hack` dependency.
- The serde forms are stored in Postgres and sent to the web app; changing a
  tag or rename is a data migration.
