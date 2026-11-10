INSERT INTO email_sfs_mappings (source, destination) SELECT * FROM UNNEST($1::text[], $2::text[]) ON CONFLICT (source) DO NOTHING
