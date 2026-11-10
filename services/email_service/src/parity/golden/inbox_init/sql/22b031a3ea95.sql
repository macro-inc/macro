INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES ($1,$2,$3,$4,'address_book') ON CONFLICT DO NOTHING
