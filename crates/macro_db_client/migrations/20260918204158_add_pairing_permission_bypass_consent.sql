ALTER TABLE harness_pairing_requests
    ADD COLUMN requested_allow_permission_bypass boolean;

COMMENT ON COLUMN harness_pairing_requests.requested_allow_permission_bypass IS
    'Daemon operator consent ceiling: false forbids permission bypass at approval, true permits user confirmation, NULL preserves legacy web-only consent.';
