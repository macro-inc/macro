-- OAuth completion stages credentials; only email initialization adopts them.
-- Keep the legacy owner/address table for older authentication adapters.
CREATE TABLE microsoft_oauth_grant_versions
    (LIKE microsoft_oauth_grants INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE microsoft_oauth_grant_versions ADD PRIMARY KEY (grant_id);
INSERT INTO microsoft_oauth_grant_versions SELECT * FROM microsoft_oauth_grants WHERE grant_id IS NOT NULL;
CREATE UNIQUE INDEX microsoft_oauth_grant_versions_owner_generation
    ON microsoft_oauth_grant_versions(fusionauth_user_id,email_address,generation);
ALTER TABLE microsoft_link_attempts ADD COLUMN grant_id uuid
    REFERENCES microsoft_oauth_grant_versions(grant_id) ON DELETE SET NULL;
UPDATE microsoft_link_attempts a SET grant_id=g.grant_id
FROM in_progress_user_link p JOIN microsoft_oauth_grant_versions g
    ON g.fusionauth_user_id=p.macro_user_id::text AND g.email_address=p.linked_email
WHERE a.id=p.id AND a.completed_at IS NOT NULL AND p.email_provider='OUTLOOK';
