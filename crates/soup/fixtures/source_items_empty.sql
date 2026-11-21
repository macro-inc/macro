-- Model a projection that has not been backfilled yet. The item-table read path
-- must keep returning the existing records while projected reads are disabled.
TRUNCATE source_items;
