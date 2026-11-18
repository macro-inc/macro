-- Match normalize_contact_email's existing 320-byte limit. This table is new
-- and has no service writer until the later activation phase.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_email_rule_addresses
    DROP CONSTRAINT crm_email_rule_addresses_address_check,
    ADD CONSTRAINT crm_email_rule_addresses_address_check CHECK (
        address = lower(btrim(address)) AND octet_length(address) BETWEEN 3 AND 320
        AND address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    );
