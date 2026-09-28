-- Intentionally validate existing rows: rollback must fail if any non-user owner exists.
ALTER TABLE "Document"
    ADD CONSTRAINT "Document_owner_fkey" FOREIGN KEY (owner)
    REFERENCES "User" (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project"
    ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chat"
    ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE agent_session
    ADD CONSTRAINT agent_session_owner_id_fkey FOREIGN KEY (owner_id)
    REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE scheduled_action
    ADD CONSTRAINT scheduled_action_owner_fkey FOREIGN KEY (owner)
    REFERENCES "User" (id) ON DELETE CASCADE;
