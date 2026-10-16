-- no-transaction
-- "DocumentPermission_pkey" is the same unique btree on "documentId".
-- This second index had the lookups (about 1/s) and the primary key had
-- none, so both were maintained on every insert. After the drop, those
-- lookups use the primary key.
DROP INDEX CONCURRENTLY IF EXISTS "DocumentPermission_documentId_key";
