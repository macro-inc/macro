INSERT INTO calendar_change_counters (link_id, seq) VALUES ($1, $2) ON CONFLICT (link_id) DO UPDATE SET seq = calendar_change_counters.seq + EXCLUDED.seq, updated_at = now() RETURNING seq
