SELECT EXISTS( SELECT 1 FROM crm_contacts WHERE company_id = $1 LIMIT 1 ) AS "exists!"
