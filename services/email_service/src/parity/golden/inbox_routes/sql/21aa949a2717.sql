UPDATE email_link_microsoft_scopes SET calendar_disabled_at=now(),updated_at=now() WHERE link_id=$1
