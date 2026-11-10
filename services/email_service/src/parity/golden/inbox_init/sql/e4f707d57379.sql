INSERT INTO email_mailbox_watch_work(link_id) VALUES($1) ON CONFLICT(link_id) DO UPDATE SET next_run_at=now(),revision=email_mailbox_watch_work.revision+1
