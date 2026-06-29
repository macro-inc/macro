DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'webhook'
          AND column_name = 'headers_encrypted'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'webhook'
          AND column_name = 'headers'
    ) THEN
        ALTER TABLE webhook RENAME COLUMN headers_encrypted TO headers;
    END IF;
END $$;
