-- First-party bots stop being rows.
--
-- Their ids are compile-time constants (`bot_id::SYSTEM_BOTS`), so a row was
-- only ever a second copy of that: seeded by migration, looked up at runtime,
-- and able to be missing in an environment whose code was already ready.
-- Identity now comes from the registry; `bots` holds user- and team-owned
-- bots only.

-- Dropped before the delete below, and not re-added. The constraint is
-- ON DELETE CASCADE, so removing the system rows while it exists would take
-- every agent_session referencing them along with it. `agent_session.bot_id`
-- is now resolved by the registry-or-row lookup in `BotRepo::get_bot`.
--
-- Nothing relied on the cascade: `BotRepo::delete_bot` soft-deletes (sets
-- deleted_at), so no bot row is ever hard-deleted and the cascade never fired.
ALTER TABLE agent_session DROP CONSTRAINT IF EXISTS agent_session_bot_id_fkey;

DELETE FROM bots WHERE kind = 'system';

-- Enforces the invariant rather than leaving it to convention: no future seed
-- can reintroduce a system row that would shadow the registry.
ALTER TABLE bots
  ADD CONSTRAINT bots_are_owned_only CHECK (kind = 'owned');
