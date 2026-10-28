-- Macro Databases: a database row is a property entity; its cells are its
-- entity properties. The value gets its own migration because Postgres
-- refuses an enum value in the transaction that adds it, and the next
-- migration's triggers compare against it.
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'DATABASE_ROW';
