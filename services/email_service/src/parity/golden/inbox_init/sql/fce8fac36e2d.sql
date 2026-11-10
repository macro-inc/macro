INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key) VALUES($1,$2,'catalog','') ON CONFLICT(link_id,kind,resource_key) DO UPDATE SET next_run_at=now()
