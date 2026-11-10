INSERT INTO crm_companies (id, team_id, custom_name, manually_created, first_interaction, last_interaction) VALUES ($6, $1, $2, $3, $4, $5) RETURNING id
