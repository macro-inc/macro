INSERT INTO crm_contact_sources (contact_id, link_id) VALUES ($1, $2) ON CONFLICT (contact_id, link_id) DO NOTHING
