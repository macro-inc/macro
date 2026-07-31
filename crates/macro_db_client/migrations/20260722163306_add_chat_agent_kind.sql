-- Track what kind of agent backs a chat directly on the chat row, rather
-- than in a separate presence table. All existing chats are native Macro
-- chats.
ALTER TABLE "Chat"
    ADD COLUMN "agentKind" TEXT NOT NULL DEFAULT 'MacroChat'
        CONSTRAINT "chat_agent_kind" CHECK ("agentKind" IN ('MacroChat', 'External'));
