[x] We're duplicating a bunch of stuff from the chat crate instead of just using the chat
crate. The chat crates defines the storage model for external agents. We should import and use
in this crate.

Already the case: `agent_proxy` imports `ChatAgentKind`, `ChatErr`, `ChatResponse`,
`CreateChatArgs`, `PatchChatArgs`, `ChatRepo`, and `MessageRepo` directly from the `chat` crate
and has no persistence layer of its own (`services/agent_proxy_service` wires up
`chat::outbound::postgres::PgChatRepo` directly). No duplicated storage model found.

[x] agent kind should exist as a col on the chat table not a new table. This should be non-nullable
and all prior chats  should be of type "MacroChat". this pr should only have one migraiton so you 
can unapply the old migration to the localdb delete it then create the new one.

Dropped `external_agent_chats` locally, deleted its migration, and replaced it with a single new
migration adding `"Chat"."agentKind"` (`TEXT NOT NULL DEFAULT 'MacroChat'`, `CHECK` constrained to
`MacroChat`/`External`). Updated `insert_chat`/`get_agent_kind` queries and tests accordingly.

# don't do this one yet
[] connection gateway / live update path is completely chudded. This should pretty much mirror how DCS does this.
Though we may need to work to make this into a crate or smth 
to avoid duplication.
  - I don't know what we're sending over connection gateway bc we're using untyped json. which we should not be doing
