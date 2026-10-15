-- Model a projection that has not been backfilled yet. The legacy read path
-- must keep returning the existing domain records while rollout is disabled.
TRUNCATE source_items;
