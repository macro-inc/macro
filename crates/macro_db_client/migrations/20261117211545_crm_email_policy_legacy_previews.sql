-- A count preview never initializes consent. Legacy observations remain bound
-- to the member/mailbox/consent rows the caller inspected.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_email_policy_previews
    ALTER COLUMN consent_incarnation DROP NOT NULL,
    ADD COLUMN observed_token JSONB,
    ADD COLUMN observed_fingerprint TEXT,
    ADD COLUMN request_hash BYTEA,
    ADD COLUMN run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN as_of TIMESTAMPTZ,
    ADD COLUMN traceparent TEXT,
    ADD CONSTRAINT crm_email_policy_previews_observation CHECK (
        (num_nonnulls(request_hash,observed_token,observed_fingerprint)=0
            AND consent_incarnation IS NOT NULL)
        OR (num_nonnulls(request_hash,observed_token,observed_fingerprint)=3 AND octet_length(request_hash)=32 AND jsonb_typeof(observed_token)='object'
            AND octet_length(observed_token::text)<=1024
            AND length(observed_fingerprint)=64)
    ) NOT VALID;
