-- Preserve the adopted token envelope when reverting the runtime reader.
INSERT INTO microsoft_oauth_grants (fusionauth_user_id,email_address,refresh_token_ciphertext,encrypted_data_key,nonce,encryption_version,kms_key_id,created_at,updated_at,last_refreshed_at,grant_id,generation,revision,tenant_id,subject_id,mailbox_id,scopes,revoked_at,refresh_lease_id,refresh_lease_until)
SELECT DISTINCT ON (g.fusionauth_user_id,g.email_address) g.fusionauth_user_id,g.email_address,g.refresh_token_ciphertext,g.encrypted_data_key,g.nonce,g.encryption_version,g.kms_key_id,g.created_at,g.updated_at,g.last_refreshed_at,g.grant_id,g.generation,g.revision,g.tenant_id,g.subject_id,g.mailbox_id,g.scopes,g.revoked_at,g.refresh_lease_id,g.refresh_lease_until
FROM microsoft_oauth_grant_versions g
ORDER BY g.fusionauth_user_id,g.email_address,
    EXISTS(SELECT 1 FROM email_links l WHERE l.grant_id=g.grant_id AND l.grant_generation=g.generation) DESC,
    g.generation DESC
ON CONFLICT (fusionauth_user_id,email_address) DO UPDATE SET
    refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
    encrypted_data_key=EXCLUDED.encrypted_data_key,
    nonce=EXCLUDED.nonce,
    encryption_version=EXCLUDED.encryption_version,
    kms_key_id=EXCLUDED.kms_key_id,
    created_at=EXCLUDED.created_at,
    updated_at=EXCLUDED.updated_at,
    last_refreshed_at=EXCLUDED.last_refreshed_at,
    grant_id=EXCLUDED.grant_id,
    generation=EXCLUDED.generation,
    revision=EXCLUDED.revision,
    tenant_id=EXCLUDED.tenant_id,
    subject_id=EXCLUDED.subject_id,
    mailbox_id=EXCLUDED.mailbox_id,
    scopes=EXCLUDED.scopes,
    revoked_at=EXCLUDED.revoked_at,
    refresh_lease_id=EXCLUDED.refresh_lease_id,
    refresh_lease_until=EXCLUDED.refresh_lease_until;
ALTER TABLE microsoft_link_attempts DROP COLUMN grant_id;
DROP TABLE microsoft_oauth_grant_versions;
