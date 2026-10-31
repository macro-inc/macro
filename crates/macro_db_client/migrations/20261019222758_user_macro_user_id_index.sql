-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
CREATE INDEX CONCURRENTLY "User_macro_user_id_idx" ON "User" (macro_user_id);
