INSERT INTO calendar_backfill_jobs ( id, email_link_id, account_id, kind, grant_version ) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email_link_id, kind, grant_version) DO NOTHING RETURNING id
