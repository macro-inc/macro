-- no-transaction

-- Channel name search matches `comms_channels.name ILIKE '%term%'`; a trigram
-- index serves that substring match (pg_trgm is created by 20260106165341).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comms_channels_name_trgm
    ON comms_channels USING gin (name gin_trgm_ops);
