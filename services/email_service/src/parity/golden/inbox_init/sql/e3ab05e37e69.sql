INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,$3,'folder_catalog','mail') ON CONFLICT DO NOTHING
