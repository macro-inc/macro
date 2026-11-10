INSERT INTO promoted_shared_mailboxes (macro_id) VALUES ($1) ON CONFLICT (macro_id) DO NOTHING
