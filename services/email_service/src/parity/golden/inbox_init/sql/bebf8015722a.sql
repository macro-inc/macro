UPDATE email_links SET fusionauth_user_id = $2, updated_at = NOW() WHERE id = $1
