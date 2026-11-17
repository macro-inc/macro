-- What runs each Macro computer host's guests, and whether new purchases may
-- be placed on it. Existing hosts are Incus hosts that admit purchases, so
-- nothing changes for them. Purchases are placed only on admitting Incus
-- hosts until other backends are wired up; a control plane drives only the
-- hosts it registered.

CREATE TYPE hosted_runtime_backend AS ENUM ('incus', 'firecracker', 'docker');

ALTER TABLE hosted_runtime_host
    ADD COLUMN backend hosted_runtime_backend NOT NULL DEFAULT 'incus',
    -- False stops new purchases from being placed on the host.
    ADD COLUMN admitting BOOLEAN NOT NULL DEFAULT true;
