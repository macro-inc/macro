SELECT source, destination FROM email_sfs_mappings WHERE source = ANY($1)
