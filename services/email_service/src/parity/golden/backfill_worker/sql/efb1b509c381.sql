SELECT team_id FROM team_user WHERE user_id = $1 ORDER BY team_role DESC LIMIT 1
