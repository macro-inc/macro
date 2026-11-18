-- Record the primary address of every existing contact. The trigger from the
-- previous migration already covers rows written since, so this only fills
-- in what it finds missing.
INSERT INTO crm_contact_emails (contact_id, email)
SELECT id, LOWER(BTRIM(email))
FROM crm_contacts
WHERE NULLIF(BTRIM(email), '') IS NOT NULL
ON CONFLICT (contact_id, email) DO NOTHING;
