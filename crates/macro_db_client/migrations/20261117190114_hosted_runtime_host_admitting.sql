-- Whether new purchases may be placed on a Macro computer host. Existing
-- hosts admit purchases, so nothing changes for them; turning a host's
-- admitting off drains it of new purchases without touching its computers.

-- Purchases and effect leases lock host rows; never queue behind one of them.
SET LOCAL lock_timeout = '3s';

ALTER TABLE hosted_runtime_host
    ADD COLUMN admitting BOOLEAN NOT NULL DEFAULT true;
