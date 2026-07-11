ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE crm_companies c
SET name = dd.name
FROM crm_domains d
JOIN crm_domain_directory dd ON LOWER(dd.domain) = LOWER(d.domain)
WHERE d.company_id = c.id
  AND dd.name IS NOT NULL
  AND c.name IS NULL;

UPDATE crm_companies SET name = 'TODO' WHERE name IS NULL;

ALTER TABLE crm_companies ALTER COLUMN name SET NOT NULL;

DROP TABLE IF EXISTS crm_domain_directory;
