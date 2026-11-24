-- no-transaction
-- macro_user_links_link_primary_idx (link_id, primary_macro_id) serves every
-- query that used this index. Single statement on purpose: see
-- 20261119030403_macro_user_links_link_primary_index.sql.
DROP INDEX CONCURRENTLY IF EXISTS macro_user_links_link_idx;
