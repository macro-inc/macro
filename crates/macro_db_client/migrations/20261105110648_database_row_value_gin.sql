-- no-transaction
-- Database views filter select and reference columns by membership,
-- `values->'value' @> '["<option>"]'` or `@> '[{"entity_id": …}]'`. Since
-- idx_entity_properties_values_gin was dropped, those filters read every cell
-- of the column (0.6-1 s for 1.7k matches in a 100k-row table); with this
-- index they read only the matches (20-40 ms). It covers database row
-- select and reference cells only, so other entity properties and text,
-- number and date cells pay nothing on insert. The view query repeats both
-- predicate terms as literals so a generic plan can use it. Must stay a single
-- statement: sqlx sends no-transaction migrations as one batch, and
-- CONCURRENTLY cannot run inside a transaction. IF NOT EXISTS does not repair
-- an INVALID index from an interrupted build; drop it concurrently before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ep_database_row_value_gin
ON entity_properties
USING gin ((values->'value') jsonb_path_ops)
WHERE entity_type = 'DATABASE_ROW'
AND values->>'type' IN ('SelectOption', 'EntityReference');
