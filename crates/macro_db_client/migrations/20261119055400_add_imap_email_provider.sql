-- New values are additive so rolling deployments keep accepting existing providers.
ALTER TYPE email_user_provider_enum ADD VALUE IF NOT EXISTS 'IMAP';
