-- Who a Notion workspace import shares with, and rows waiting on a
-- teammate's copy.
--
-- `import_run.sharing` is what the user chose when planning: 'team' (share
-- everything the import writes with their team), 'personal', or 'ai' (the
-- decision model chooses per object). An adopted planning run plans again
-- with it.
--
-- `import_entity.waiting_on` is set on a row whose object a teammate is
-- writing for the team at the same moment: the row stays `importing` until
-- that teammate's row (`waiting_on`) becomes `imported`, then links to the
-- same Macro entity. A teammate's row going back to `staged` releases its
-- waiters back to `staged` too.
--
-- Both columns are nullable, so code deployed before this change keeps
-- working; the index backing the foreign key is built CONCURRENTLY next.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN sharing TEXT CHECK (sharing IN ('team', 'personal', 'ai'));

ALTER TABLE import_entity
    ADD COLUMN waiting_on UUID REFERENCES import_entity (id) ON DELETE SET NULL;
