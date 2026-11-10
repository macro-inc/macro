SELECT EXISTS( SELECT 1 FROM crm_contact_sources WHERE contact_id = $1 LIMIT 1 ) AS "exists!"
